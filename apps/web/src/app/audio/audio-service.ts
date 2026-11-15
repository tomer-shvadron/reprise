import {
  createAudioEngine,
  GM_BUDGET_BYTES,
  Sf2ParseError,
  Sf2Soundfont,
  timelineNeutral,
  checkClickSettings,
  type AudioEngine,
  type ClickSettings,
  type LoadOptions,
  type PlaybackState,
  type PreviewNote,
  type PreviewOptions,
  type TempoMode,
  type Ticker,
  type TrackParams,
} from '@reprise/audio';
import type { Id, Score } from '@reprise/model';

import { selectCanPlay, type PlaybackStore, type PlaybackStoreState } from '@/state/playback';
import type { BarRange } from '@/state/selection';

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

export const PREVIEW_VELOCITY_RANGE = { min: 1, max: 127 } as const;
export const PREVIEW_SECONDS_RANGE = { min: 0.05, max: 5 } as const;
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
  /** After a sound, song or output error. */
  retry(): void;
  /** Resolves with no rebuild pending, the document's load done and no decode in flight. */
  settled(): Promise<void>;
  debug(): AudioServiceDebug;
  dispose(): void;
}

const GM: LoadOptions = { tier: 'gm', packs: [] };

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
    defer = (run) => setTimeout(run, 0),
  } = options;

  const engine = createAudioEngine({
    context: createContext,
    budgetBytes,
    ...(options.scheduler && { scheduler: options.scheduler }),
    ...(options.frames && { frames: options.frames }),
    ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
  });
  const initial = playback.getState().settings;
  engine.setTempo(initial.tempo.mode, initial.tempo.value);
  engine.setCountIn(initial.countIn);
  engine.setMetronome(initial.metronome.on, initial.metronome.volume);
  engine.setMasterVolume(initial.masterVolume);
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
  let disposed = false;
  const inflight = new Set<Promise<unknown>>();

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
      const { instruments } = await engine.load(doc.score, GM);
      if (gen === generation) {
        set({ song: { status: 'ready', error: undefined }, instruments: instruments.length });
      }
    } catch (error) {
      if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
    }
  }

  /** Hands the engine the document's latest score; the engine keeps the position (Q5). */
  function reload(): void {
    if (!doc || !loaded) return;
    const gen = generation;
    engineScore = doc.score;
    void track(
      engine.load(doc.score, GM).then(
        ({ instruments }) => {
          if (gen === generation) set({ instruments: instruments.length });
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
            if (!disposed) reload();
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
    set({ mixer: {}, instrumentLoads: {}, position: undefined, ...partial });
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
        if (!rebuildQueued && timelineNeutral(previous, next.score)) reload();
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
