import {
  createAudioEngine,
  GM_BUDGET_BYTES,
  Sf2ParseError,
  Sf2Soundfont,
  tierOf,
  timelineNeutral,
  checkClickSettings,
  type AudioEngine,
  type ClickSettings,
  type LoadOptions,
  type PackAssignment,
  type PlaybackState,
  type EffectStage,
  type PreviewNote,
  type PreviewOptions,
  type TempoMode,
  type Ticker,
  type TrackParams,
} from '@reprise/audio';
import type { Id, Score } from '@reprise/model';

import {
  MEMORY_BUDGET_RANGE,
  selectCanPlay,
  type PlaybackStore,
  type PlaybackStoreState,
  type TrackSound,
} from '@/state/playback';
import type { BarRange } from '@/state/selection';
import type { DefaultSounds, InstalledPackSource, PackDirectory } from '@/state/sound-packs';

import { resolveTrackSound } from './track-sound';

import { loadGmSoundfont, SoundfontError, type SoundfontLoader } from './soundfont-loader';

export interface AudioServiceOptions {
  playback: PlaybackStore;
  loadSoundfont?: SoundfontLoader;
  createContext?: () => BaseAudioContext;
  /** Offline tests drive the engine with manual tickers. */
  scheduler?: Ticker;
  frames?: Ticker;
  startLatency?: number;
  budgetBytes?: number;
  /** The memory setting's initial value; `settings.memoryBudgetBytes` when absent. */
  hqBudgetBytes?: number;
  /**
   * Where installed sound packs come from. A track naming a pack the directory has plays an HQ
   * assignment; the service reloads when the directory changes. None: every track is GM.
   */
  packs?: PackDirectory;
  /**
   * The family defaults of the user's settings (#346): the sound of a track that chose none. A
   * change reloads the song like an installed-set change does. None: no default.
   */
  defaults?: DefaultSounds;
  /** Runs an edit's rebuild; a task later by default, out of the layout's task. */
  defer?: (run: () => void) => void;
}

export interface OpenDocument {
  id: Id;
  score: Score;
}

/** The engine behind the service; tests reach its live objects with `@reprise/audio/testing`. */
export interface AudioServiceDebug {
  engine: AudioEngine;
}

export type { PreviewNote, PreviewOptions };

export { MEMORY_BUDGET_RANGE };
export const PREVIEW_VELOCITY_RANGE = { min: 1, max: 127 } as const;
export const PREVIEW_SECONDS_RANGE = { min: 0.05, max: 5 } as const;
/** A `previewBeat` that waited longer than this for a rebuild is dropped: late feedback is worse than none. */
const PREVIEW_BEAT_LATE_MS = 250;
const MAX_FRET = 127;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface AudioService {
  /** Creates the AudioContext on the first call, resumes a suspended one after. */
  unlock(): void;
  setDocument(document: OpenDocument | undefined): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  stop(): void;
  /** Ignored until the engine has the open song, which waits on the sound bank. */
  seek(tick: number): void;
  /** Seconds between the clock positions are read from and what is heard; 0 with no context. */
  outputLatency(): number;
  setTempo(mode: TempoMode, value: number): void;
  setLoop(range?: BarRange): void;
  setCountIn(on: boolean): void;
  setMetronome(on: boolean, volume: number): void;
  /**
   * Starts a metronome that needs no song, from `settings` over what the last call set
   * (`playback.click.settings`; 100 bpm in 4 with the downbeat stressed at first). Unlocks the
   * context, so call it from a gesture. Pauses a playing song; playing a song stops the click.
   * A failing output is reported as `output.status: 'error'`, never thrown. Throws a `RangeError` for a bpm outside 10 to 600, beats outside 1 to 32, a subdivision
   * outside 1 to 4 or a volume outside 0 to 1, leaving the click as it was.
   */
  startClick(settings?: Partial<ClickSettings>): void;
  /** Applies settings to a running click from its next click or beat, or keeps them for the next start. */
  updateClick(settings: Partial<ClickSettings>): void;
  stopClick(): void;
  /**
   * The master bus level, 0 to 1, mirrored into `settings.masterVolume`. The metronome feeds the
   * bus, so it scales the clicks too. Throws a `RangeError` outside 0 to 1.
   */
  setMasterVolume(volume: number): void;
  /**
   * Whether the automatic preset is skipped on GM-tier tracks, mirrored into
   * `settings.gmTierBypass`; on by default. A track's known `sound.preset` applies either way.
   */
  setGmTierBypass(on: boolean): void;
  /**
   * "Memory for sounds": the HQ tier's budget, which also caps the GM tier's at 80 MiB, mirrored
   * into `settings.memoryBudgetBytes` and `memory.budgetBytes`. Lowering it evicts at once and
   * raising it decodes the open song again. Throws a `RangeError` outside `MEMORY_BUDGET_RANGE`.
   */
  setMemoryBudget(bytes: number): void;
  /** Frees the instruments the open song does not use (`memory.unused`); returns how many. */
  unloadUnused(): number;
  /**
   * Bypasses one stage of a track's effects chain, or restores it, for the session: nothing is
   * saved, and the engine clears it when the song unloads. For the Sounds screen's demo.
   */
  setStageBypass(trackId: Id, stage: EffectStage, bypassed: boolean): void;
  /** A user override over the track's channel, kept through every baseline reset. */
  setTrack(id: Id, params: TrackParams): void;
  /**
   * Sets the strip's volume or pan for a slider being dragged: no override and no store write, so
   * the next baseline reset or the committed edit replaces it.
   */
  previewTrack(id: Id, params: Pick<TrackParams, 'volume' | 'pan'>): void;
  /**
   * Sounds one note through the track's strip (its program, bank, volume and pan) past mute and
   * solo, stopped or playing, so entering or clicking a note is heard. `{ string, fret }` resolves
   * through the track's tuning and capo as playback does; `{ pitch }` is a MIDI key. `options`:
   * `velocity` (1 to 127, default 96) and `seconds` (0.05 to 5, default 0.6), the note's length.
   *
   * Call it last in a handler: it throws before unlocking or touching the engine, and a handler
   * that has already changed the score should not be cut short. Contract:
   * - A `RangeError` for a track the open song lacks, a string outside the track's tuning (frets
   *   count from 1 at the top string; not checked on a drum or pitched track), a fret that is not
   *   an integer from 0 to 127, and a non-finite velocity, seconds or pitch.
   * - A finite velocity, seconds or pitch outside its range is clamped (the pitch to 0 to 127,
   *   rounded): unlike a string or fret, it names no place that does not exist.
   * - Nothing happens, with no error, with no document, while it loads, in the window where the
   *   document is ahead of the engine's song (a queued rebuild) for a track the engine lacks, or
   *   when the output failed.
   * - It unlocks the context, so call it from a gesture. A sample not yet decoded is requested and
   *   the note starts when it is resident, unless that takes over half a second. A newer preview
   *   on the same string (or key) replaces a waiting one; `stop` cancels it.
   */
  previewNote(trackId: Id, note: PreviewNote, options?: PreviewOptions): void;
  /**
   * Sounds one beat of the open song as written, effects included (bends, slides, palm mute,
   * golpe, wah, let ring and the rest), through the same planning as playback, so applying an
   * effect in the editor is heard. No options: the beat's own notes, dynamics and tempo, the last
   * strike sounding at least 0.6 s. Stopped or playing, past mute and solo; it never touches the
   * song's voices, mixer or pedal. Not applied: a mid-song program, volume or pan change on the
   * beat. Contract, as `previewNote`:
   * - A `RangeError` for a track or beat the open song lacks, thrown before unlocking or touching
   *   the engine, so call it last in a handler.
   * - Nothing happens, with no error, with no document, while it loads, when the output failed, for
   *   a beat in a bar playback never reaches and for a sample not yet decoded (it misses once).
   * - It unlocks the context, so call it from a gesture. When an edit has queued a rebuild or a
   *   load is in flight it then waits for `settled()`, so the beat sounds as edited; a preview
   *   that waited over 250 ms is dropped and a newer one replaces a waiting one.
   */
  previewBeat(trackId: Id, beatId: Id): void;
  /**
   * Undoes `releasePack` for a pack that is still installed (the folder removal failed): the song
   * reloads with it. A no-op for a pack that was not released.
   */
  reinstatePack(id: string): Promise<void>;
  /**
   * Reloads the open song without pack `id`: its tracks play GM, as a pack that is not installed.
   * Resolves once the engine holds no reader for the pack's files, so the caller can delete them.
   * The pack stays out until the directory lists a different version of it (or no longer lists it).
   */
  releasePack(id: string): Promise<void>;
  /** After a sound, song or output error. */
  retry(): void;
  /** Resolves with no rebuild pending, the document's load done and no decode in flight. */
  settled(): Promise<void>;
  debug(): AudioServiceDebug;
  dispose(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isRunning = (state: PlaybackState) => state === 'playing' || state === 'counting-in';

export function createAudioService(options: AudioServiceOptions): AudioService {
  const {
    playback,
    loadSoundfont = loadGmSoundfont,
    createContext = () => new AudioContext({ latencyHint: 'interactive' }),
    budgetBytes = GM_BUDGET_BYTES,
    packs: directory,
    defaults,
    defer = (run) => setTimeout(run, 0),
  } = options;

  const initial = playback.getState().settings;
  const engine = createAudioEngine({
    context: createContext,
    budgetBytes,
    hqBudgetBytes: options.hqBudgetBytes ?? initial.memoryBudgetBytes,
    ...(options.scheduler && { scheduler: options.scheduler }),
    ...(options.frames && { frames: options.frames }),
    ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
  });
  engine.setTempo(initial.tempo.mode, initial.tempo.value);
  engine.setCountIn(initial.countIn);
  engine.setMetronome(initial.metronome.on, initial.metronome.volume);
  engine.setMasterVolume(initial.masterVolume);
  engine.setGmTierBypass(initial.gmTierBypass);
  engine.updateClick(playback.getState().click.settings);
  let bankLoad: Promise<void> | undefined;
  let doc: OpenDocument | undefined;
  /** The engine has this document's song. */
  let loaded = false;
  /** The score the engine holds, which trails `doc` while a rebuild is queued. */
  let engineScore: Score | undefined;
  let mixer: Record<Id, TrackParams> = {};
  let generation = 0;
  let transport: PlaybackState = 'stopped';
  let rebuildQueued = false;
  /** The `previewBeat` waiting on a rebuild: the newest wins. */
  let pendingBeat: object | undefined;
  let disposed = false;
  const inflight = new Set<Promise<unknown>>();
  /** Packs `releasePack` took out, by the files object they had; see `releasePack`. */
  const released = new Map<string, InstalledPackSource['files']>();
  /** Bumped by every engine load, so only the latest one mirrors `trackSounds`. */
  let loadSeq = 0;
  /**
   * Assignments the engine reported as fallbacks, by track, keyed by what it checked (pack id,
   * files object, default path): the next load shows them failed at once and, with nothing else
   * assigned, asks for the GM tier, instead of flickering through HQ while the engine confirms.
   */
  let failures = new Map<
    Id,
    {
      packId: string;
      files: InstalledPackSource['files'];
      path: string | undefined;
      message: string;
    }
  >();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(settled);
    void settled.then(() => inflight.delete(settled));
    return promise;
  };

  const set = (partial: Partial<PlaybackStoreState>) => {
    if (!disposed) playback.setState(partial);
  };
  const setSettings = (partial: Partial<PlaybackStoreState['settings']>) => {
    set({ settings: { ...playback.getState().settings, ...partial } });
  };

  const cleanups = [
    ...(directory
      ? [
          directory.subscribe(() => {
            if (!disposed && doc && loaded) scheduleRebuild();
          }),
        ]
      : []),
    ...(defaults
      ? [
          defaults.subscribe(() => {
            if (!disposed && doc && loaded) scheduleRebuild();
          }),
        ]
      : []),
    engine.on('state', (state) => {
      transport = state;
      set({ transport: state });
    }),
    engine.on('position', (position) => {
      set({ position });
    }),
    engine.on('loop', (loop) => {
      set({ lastLoop: loop });
    }),
    engine.on('click', (running) => {
      set({ click: { ...playback.getState().click, running } });
    }),
    engine.on('memory', (memory) => {
      set({ memory });
    }),
    engine.on('instrumentLoads', (instrumentLoads) => {
      set({ instrumentLoads });
    }),
  ];

  /** The installed pack a track names, unless it was released and not reinstalled since. */
  function installedPack(id: string): InstalledPackSource | undefined {
    const found = directory?.get(id);
    if (!found) {
      released.delete(id);
      return undefined;
    }
    return released.get(id) === found.files ? undefined : found;
  }

  /**
   * The engine's `LoadOptions` for a score, and what is already known about each track: a pack
   * that is not installed, or whose instrument is not in it, is `missing`. The tier is `hq` while
   * at least one assignment not known to fail reaches the engine, which selects the HQ memory
   * budget.
   */
  function loadOptionsFor(score: Score): {
    options: LoadOptions;
    sounds: Record<Id, TrackSound>;
  } {
    const assignments: PackAssignment[] = [];
    /** The assignments not already known to fail: the ones that make the song HQ. */
    const playing: PackAssignment[] = [];
    const sounds: Record<Id, TrackSound> = {};
    const lookup = { get: installedPack };
    for (const track of score.tracks) {
      const { assignment, sound } = resolveTrackSound(track, lookup, defaults);
      if (!assignment) {
        sounds[track.id] = sound;
        continue;
      }
      assignments.push(assignment);
      const failed = failures.get(track.id);
      if (
        failed?.packId === assignment.pack.id &&
        failed.files === assignment.pack.files &&
        failed.path === assignment.entries.default
      ) {
        sounds[track.id] = { ...sound, problem: 'failed', message: failed.message };
      } else {
        playing.push(assignment);
        sounds[track.id] = sound;
      }
    }
    for (const track of score.tracks) {
      const known = sounds[track.id];
      if (known && known.problem === undefined) {
        sounds[track.id] = { ...known, tier: tierOf(track, playing) };
      }
    }
    return { options: { tier: playing.length > 0 ? 'hq' : 'gm', packs: assignments }, sounds };
  }

  /** Writes `trackSounds` only when it differs, so an edit that changes no sound wakes nobody. */
  function setTrackSounds(next: Record<Id, TrackSound>): void {
    const current = playback.getState().trackSounds;
    const ids = Object.keys(next);
    const same =
      ids.length === Object.keys(current).length &&
      ids.every((id) => {
        const a = current[id];
        const b = next[id];
        return (
          a !== undefined &&
          b !== undefined &&
          a.tier === b.tier &&
          a.packId === b.packId &&
          a.source === b.source &&
          a.problem === b.problem &&
          a.message === b.message
        );
      });
    if (!same) set({ trackSounds: next });
  }

  /**
   * Loads a score into the engine and, when no later load started meanwhile, mirrors the tiers
   * with the engine's fallbacks as `failed`. Resolves with `latest: false` for an overtaken load,
   * whose result the store must not show: the engine kept the newer one's packs.
   */
  async function runLoad(score: Score): Promise<{ instruments: number; latest: boolean }> {
    loadSeq += 1;
    const mine = loadSeq;
    const { options: loadOptions, sounds } = loadOptionsFor(score);
    setTrackSounds(sounds);
    const { instruments, fallbacks } = await engine.load(score, loadOptions);
    if (mine !== loadSeq) return { instruments: instruments.length, latest: false };
    const next = { ...sounds };
    failures = new Map();
    for (const { trackId, error } of fallbacks) {
      next[trackId] = { ...next[trackId], tier: 'gm', problem: 'failed', message: error };
      const assigned = loadOptions.packs.find((entry) => entry.trackId === trackId);
      if (assigned) {
        failures.set(trackId, {
          packId: assigned.pack.id,
          files: assigned.pack.files,
          path: assigned.entries.default,
          message: error,
        });
      }
    }
    setTrackSounds(next);
    // Every assignment failed on an HQ load: reload once so the budget and tiers return to GM.
    if (
      loadOptions.tier === 'hq' &&
      fallbacks.length === loadOptions.packs.length &&
      doc?.score === score
    ) {
      void track(runLoad(score).then(() => undefined));
    }
    return { instruments: instruments.length, latest: true };
  }

  function ensureBank(): Promise<void> {
    bankLoad ??= (async () => {
      const sounds = (partial: Partial<PlaybackStoreState['sounds']>) => {
        set({ sounds: { ...playback.getState().sounds, ...partial } });
      };
      sounds({ status: 'loading', loaded: 0, total: undefined, error: undefined });
      try {
        const bytes = await loadSoundfont((loaded, total) => {
          sounds({ loaded, total });
        });
        let font: Sf2Soundfont;
        try {
          font = Sf2Soundfont.parse(bytes);
        } catch (error) {
          if (!(error instanceof Sf2ParseError)) throw error;
          throw new SoundfontError('damaged', `The sound bank is damaged: ${error.message}`, {
            cause: error,
          });
        }
        if (disposed) throw new Error('The audio service was disposed');
        engine.setSoundfont(font);
        set({ memory: engine.memory() });
        sounds({ status: 'ready', loaded: bytes.length, total: bytes.length, error: undefined });
      } catch (error) {
        sounds({ status: 'error', error: messageOf(error) });
        throw error;
      }
    })();
    return bankLoad;
  }

  async function loadDocument(gen: number): Promise<void> {
    try {
      await ensureBank();
      if (gen !== generation || !doc) return;
      loaded = true;
      engineScore = doc.score;
      const { instruments } = await runLoad(doc.score);
      if (gen === generation) {
        set({ song: { status: 'ready', error: undefined }, instruments });
      }
    } catch (error) {
      if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
    }
  }

  /** Hands the engine the document's latest score; the engine keeps the position (Q5). */
  function reload(): Promise<void> {
    if (!doc || !loaded) return Promise.resolve();
    const gen = generation;
    engineScore = doc.score;
    return track(
      runLoad(doc.score).then(
        ({ instruments }) => {
          if (gen !== generation) return;
          set({ instruments });
        },
        (error: unknown) => {
          if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
        },
      ),
    );
  }

  function scheduleRebuild(): void {
    if (rebuildQueued) return;
    rebuildQueued = true;
    void track(
      new Promise<void>((resolve) => {
        defer(() => {
          rebuildQueued = false;
          try {
            if (!disposed) void reload();
          } finally {
            resolve();
          }
        });
      }),
    );
  }

  function clear(partial: Partial<PlaybackStoreState>): void {
    loaded = false;
    engineScore = undefined;
    mixer = {};
    set({ mixer: {}, instrumentLoads: {}, trackSounds: {}, position: undefined, ...partial });
  }

  const service: AudioService = {
    unlock() {
      if (disposed) return;
      try {
        engine.unlock();
      } catch (error) {
        set({
          output: { status: 'error', error: `Audio output is unavailable: ${messageOf(error)}` },
        });
        return;
      }
      if (playback.getState().output.status !== 'ready') {
        set({ output: { status: 'ready', error: undefined } });
      }
    },

    setDocument(next) {
      if (disposed) return;
      if (!next) {
        if (!doc) return;
        generation += 1;
        engine.unload({ evict: true });
        doc = undefined;
        clear({ song: { status: 'idle', error: undefined }, instruments: 0 });
        return;
      }
      if (doc?.id === next.id) {
        if (doc.score === next.score) return;
        const previous = doc.score;
        doc = next;
        if (!loaded) return;
        if (!rebuildQueued && timelineNeutral(previous, next.score)) void reload();
        else scheduleRebuild();
        return;
      }
      engine.unload();
      generation += 1;
      doc = next;
      clear({
        song: { status: 'loading', error: undefined },
        settings: { ...playback.getState().settings, loop: undefined },
      });
      void track(loadDocument(generation));
    },

    play() {
      service.unlock();
      if (!loaded || !selectCanPlay(playback.getState())) return;
      engine.play();
    },

    pause() {
      engine.pause();
    },

    togglePlay() {
      if (isRunning(transport)) service.pause();
      else service.play();
    },

    stop() {
      engine.stop();
    },

    seek(tick) {
      if (!loaded) return;
      engine.seek(tick);
    },

    outputLatency() {
      return engine.outputLatency();
    },

    setTempo(mode, value) {
      engine.setTempo(mode, value);
      setSettings({ tempo: { mode, value } });
    },

    setLoop(range) {
      engine.setLoop(range);
      setSettings({ loop: range });
    },

    setCountIn(on) {
      engine.setCountIn(on);
      setSettings({ countIn: on });
    },

    setMetronome(on, volume) {
      engine.setMetronome(on, volume);
      setSettings({ metronome: { on, volume } });
    },

    startClick(settings) {
      if (disposed) return;
      const next = { ...playback.getState().click.settings, ...settings };
      // First, so a refused call makes no context.
      checkClickSettings('startClick', next);
      service.unlock();
      if (playback.getState().output.status === 'error') return;
      try {
        engine.startClick(next);
      } catch (error) {
        set({
          output: { status: 'error', error: `Audio output is unavailable: ${messageOf(error)}` },
        });
        return;
      }
      // After the engine has validated them, so a refused call leaves the mirror alone.
      set({ click: { ...playback.getState().click, settings: next } });
    },

    updateClick(settings) {
      if (disposed) return;
      const next = { ...playback.getState().click.settings, ...settings };
      engine.updateClick(next);
      set({ click: { ...playback.getState().click, settings: next } });
    },

    stopClick() {
      engine.stopClick();
    },

    setMasterVolume(volume) {
      engine.setMasterVolume(volume);
      setSettings({ masterVolume: volume });
    },

    setGmTierBypass(on) {
      engine.setGmTierBypass(on);
      setSettings({ gmTierBypass: on });
    },

    setMemoryBudget(bytes) {
      if (
        !Number.isFinite(bytes) ||
        bytes < MEMORY_BUDGET_RANGE.min ||
        bytes > MEMORY_BUDGET_RANGE.max
      ) {
        throw new RangeError(
          `setMemoryBudget: ${String(bytes)} is outside ${String(MEMORY_BUDGET_RANGE.min)} to ${String(MEMORY_BUDGET_RANGE.max)} bytes`,
        );
      }
      engine.setMemoryBudget(bytes);
      setSettings({ memoryBudgetBytes: bytes });
      // Without a sound bank the engine has no source to announce the new budget.
      set({ memory: engine.memory() });
    },

    unloadUnused() {
      return engine.unloadUnused();
    },

    setStageBypass(trackId, stage, bypassed) {
      engine.setStageBypass(trackId, stage, bypassed);
    },

    setTrack(id, params) {
      engine.setTrack(id, params);
      mixer = { ...mixer, [id]: { ...mixer[id], ...params } };
      set({ mixer });
    },

    previewTrack(id, params) {
      engine.previewTrack(id, params);
    },

    previewNote(trackId, note, options = {}) {
      if (disposed) return;
      for (const [name, value] of [
        ['velocity', options.velocity],
        ['seconds', options.seconds],
        ['pitch', 'pitch' in note ? note.pitch : undefined],
      ] as const) {
        if (value !== undefined && !Number.isFinite(value)) {
          throw new RangeError(`previewNote: ${name} must be a number, got ${String(value)}`);
        }
      }
      // No document, or one still loading: there is no song to name a track in yet.
      if (!doc || !loaded) return;
      const target = doc.score.tracks.find((entry) => entry.id === trackId);
      if (!target) throw new RangeError(`previewNote: the open song has no track ${trackId}`);
      if (!('pitch' in note)) {
        if (!Number.isInteger(note.fret) || note.fret < 0 || note.fret > MAX_FRET) {
          throw new RangeError(
            `previewNote: fret ${String(note.fret)} is not an integer in 0 to ${String(MAX_FRET)}`,
          );
        }
        if (
          target.kind === 'fretted' &&
          (!Number.isInteger(note.string) || note.string < 1 || note.string > target.tuning.length)
        ) {
          throw new RangeError(
            `previewNote: string ${String(note.string)} is outside the ${String(target.tuning.length)}-string tuning`,
          );
        }
      }
      // A queued rebuild: the track is new in the document and the engine does not have it yet.
      if (!engineScore?.tracks.some((entry) => entry.id === trackId)) return;
      service.unlock();
      if (playback.getState().output.status === 'error') return;
      engine.previewNote(
        trackId,
        'pitch' in note ? { pitch: Math.round(clamp(note.pitch, 0, 127)) } : note,
        {
          ...(options.velocity !== undefined && {
            velocity: Math.round(
              clamp(options.velocity, PREVIEW_VELOCITY_RANGE.min, PREVIEW_VELOCITY_RANGE.max),
            ),
          }),
          ...(options.seconds !== undefined && {
            seconds: clamp(options.seconds, PREVIEW_SECONDS_RANGE.min, PREVIEW_SECONDS_RANGE.max),
          }),
        },
      );
    },

    previewBeat(trackId, beatId) {
      if (disposed) return;
      if (!doc || !loaded) return;
      const has = (score: Score): boolean | undefined =>
        score.tracks
          .find((entry) => entry.id === trackId)
          ?.bars.some((bar) =>
            bar.voices.some((voice) => voice.beats.some((beat) => beat.id === beatId)),
          );
      const known = has(doc.score);
      if (known === undefined) {
        throw new RangeError(`previewBeat: the open song has no track ${trackId}`);
      }
      if (!known) throw new RangeError(`previewBeat: track ${trackId} has no beat ${beatId}`);
      // Inside the gesture, before any wait: the context can only be resumed from one.
      service.unlock();
      if (playback.getState().output.status === 'error') return;
      const token = {};
      pendingBeat = token;
      const sound = (): void => {
        if (pendingBeat !== token || disposed || !engineScore || !has(engineScore)) return;
        pendingBeat = undefined;
        engine.previewBeat(trackId, beatId);
      };
      // An edit queues a rebuild that has not reached the engine, which would sound the beat as
      // it was before; wait for it (and the loads in flight), and drop a preview that would sound
      // late, as `Sampler.previewNote` does. A newer preview replaces a waiting one.
      if (!rebuildQueued && inflight.size === 0 && engineScore === doc.score) {
        sound();
        return;
      }
      const requested = performance.now();
      const generationThen = generation;
      void service.settled().then(() => {
        if (
          generationThen === generation &&
          performance.now() - requested <= PREVIEW_BEAT_LATE_MS
        ) {
          sound();
        } else if (pendingBeat === token) pendingBeat = undefined;
      });
    },

    async releasePack(id) {
      const current = directory?.get(id);
      if (current) released.set(id, current.files);
      if (disposed) return;
      await reload();
      await service.settled();
    },

    async reinstatePack(id) {
      if (!released.delete(id) || disposed) return;
      await reload();
    },

    retry() {
      const { sounds, song, output } = playback.getState();
      if (output.status === 'error') {
        set({ output: { status: 'locked', error: undefined } });
        service.unlock();
      }
      if (sounds.status === 'error') bankLoad = undefined;
      if (doc && (sounds.status === 'error' || song.status === 'error')) {
        generation += 1;
        set({ song: { status: 'loading', error: undefined } });
        void track(loadDocument(generation));
      }
    },

    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
      await engine.settled();
    },

    debug() {
      return { engine };
    },

    dispose() {
      if (disposed) return;
      set({ click: { ...playback.getState().click, running: false } });
      disposed = true;
      generation += 1;
      for (const cleanup of cleanups.splice(0)) cleanup();
      engine.dispose();
    },
  };
  return service;
}
