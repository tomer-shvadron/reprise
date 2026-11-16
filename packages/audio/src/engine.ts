import type { Id, Score, Track } from '@reprise/model';

import { ClickSynth } from './click-synth';
import { GmBank } from './gm-bank';
import { outputLatencyOf } from './output-latency';
import { resolveEffects, stagesOf } from './effects/presets';
import type { EffectStage } from './effects/presets';
import { Sampler } from './sampler/sampler';
import type { PreviewNote, PreviewOptions, TrackParams } from './sampler/sampler';
import { createSamplerSink } from './sampler/sampler-sink';
import {
  GM_BUDGET_BYTES,
  HQ_BUDGET_BYTES,
  ManagedSampleSource,
} from './samples/managed-sample-source';
import type { BufferFactory } from './samples/managed-sample-source';
import { planInstruments, planSamples } from './samples/plan';
import type { InstrumentId, MemoryReport } from './samples/types';
import type { Sf2Soundfont } from './sf2/soundfont';
import { loadSfz } from './sfz/load';
import type { SfzFiles } from './sfz/pack';
import { tierOf } from './tier';
import type { Ticker } from './ticker';
import { timelineNeutral } from './timeline-neutral';
import {
  checkClickSettings,
  createStandaloneClick,
  DEFAULT_CLICK_SETTINGS,
} from './standalone-click';
import type { ClickSettings, StandaloneClick } from './standalone-click';
import { createTransport } from './transport';
import type { TempoMode, Transport, TransportEvents, Unsubscribe } from './transport';

export type { InstrumentId, MemoryReport } from './samples/types';
export type {
  LoopEvent,
  PlaybackState,
  PositionEvent,
  TempoMode,
  TransportEvents,
  Unsubscribe,
} from './transport';

/** One track's pack instrument: the installed pack and which of its SFZ files to play. */
export interface PackAssignment {
  trackId: Id;
  /**
   * `id` is the pack's id (no slash), the prefix of its sample refs. `files` is the same object
   * for as long as the installed version lives: a new object means the pack changed and its
   * tracks are loaded again.
   */
  pack: { id: string; files: SfzFiles };
  /**
   * SFZ paths inside the pack by articulation-set key. `default` is required and is what plays;
   * the other keys are WP-093's.
   */
  entries: Readonly<Record<string, string>>;
}

export interface LoadOptions {
  /** Selects the memory budget: `budgetBytes` for `gm`, `hqBudgetBytes` for `hq`. */
  tier: 'gm' | 'hq';
  packs: PackAssignment[];
}

/** An assigned track whose pack could not be loaded: it plays General MIDI. */
export interface LoadFallback {
  trackId: Id;
  packId: string;
  error: string;
}

/** The song plan's instruments, in first-use order. */
export interface LoadResult {
  instruments: InstrumentId[];
  /** The assigned tracks that fell back to General MIDI, in track order; empty with no packs. */
  fallbacks: LoadFallback[];
}

export interface InstrumentLoad {
  loaded: number;
  total: number;
}

/** The tracks whose new instrument is decoding, by track id. */
export type InstrumentLoads = Readonly<Record<Id, InstrumentLoad>>;

export interface AudioEngineEvents extends TransportEvents {
  memory: MemoryReport;
  instrumentLoads: InstrumentLoads;
  /** Whether the standalone click runs; also false when a song's `play` stopped it. */
  click: boolean;
}

export interface AudioEngine {
  /**
   * Over a loaded song, an edit of it: keeps the position (clamped), the state, the loop and the
   * overrides, and applies a timeline-neutral edit without rebuilding. Otherwise a new song,
   * `stopped` at tick 0. Resolves once the opening bars are decoded.
   */
  load(score: Score, options: LoadOptions): Promise<LoadResult>;
  play(fromTick?: number): void;
  pause(): void;
  stop(): void;
  seek(tick: number): void;
  setTempo(mode: TempoMode, value: number): void;
  setLoop(range?: { startBar: Id; endBar: Id }): void;
  setCountIn(on: boolean): void;
  setMetronome(on: boolean, volume: number): void;
  /**
   * Starts the standalone click: a metronome with no score, on the master bus. Makes the context
   * if needed, pauses a playing song (it keeps its position) and keeps `settings` for later when
   * given; a click already running only takes them like `updateClick`. `play` stops it again.
   */
  startClick(settings?: ClickSettings): void;
  /** Applies the settings from the next click (tempo) or beat (meter, accents, subdivision). */
  updateClick(settings: ClickSettings): void;
  stopClick(): void;
  /** The click's settings and whether it runs. */
  click(): { running: boolean; settings: ClickSettings };
  /** A user override over the track's channel, kept through every baseline reset and edit. */
  setTrack(id: Id, params: TrackParams): void;
  /**
   * One note through the track's strip (its program, bank, volume and pan), past mute and solo,
   * while stopped or playing. A fret on a string resolves through the track's tuning and capo as
   * playback does; `{ pitch }` is a MIDI key. A sample not yet decoded is requested and the note
   * starts when it is resident (dropped when that takes over 500 ms; a newer preview on the same string cancels a waiting one). `options.velocity`
   * (1 to 127) and `options.seconds` (the note's length) default to the sampler's preview values;
   * the engine passes them through, the audio service validates and clamps them.
   */
  previewNote(track: Id, note: PreviewNote, options?: PreviewOptions): void;
  on<K extends keyof AudioEngineEvents>(
    event: K,
    handler: (payload: AudioEngineEvents[K]) => void,
  ): Unsubscribe;
  memory(): MemoryReport;
  dispose(): void;
  /** Makes the context on the first call, from the factory; resumes a suspended one after. */
  unlock(): void;
  setSoundfont(font: Sf2Soundfont): void;
  /** Ends the song; `evict` frees every instrument too, as closing it should. */
  unload(options?: { evict?: boolean }): void;
  setMasterVolume(volume: number): void;
  /** A strip's volume or pan with no override: the next baseline reset or edit replaces it. */
  previewTrack(id: Id, params: Pick<TrackParams, 'volume' | 'pan'>): void;
  /**
   * Whether an automatic effects preset is skipped on GM-tier tracks (on by default): the
   * soundfont's distorted samples are already processed. A preset the track names (`sound.preset`)
   * applies on either tier. Applies to a loaded song at once.
   */
  setGmTierBypass(on: boolean): void;
  /**
   * Bypasses one stage of a track's effects chain for the session, like `setTrack`: not saved,
   * kept through edits, cleared by `unload`. The reverb stage is the track's send.
   */
  setStageBypass(trackId: Id, stage: EffectStage, bypassed: boolean): void;
  /** Seconds from the context's clock to the speaker; 0 with no context. */
  outputLatency(): number;
  /** Resolves with no load, instrument load or sample fetch in flight. */
  settled(): Promise<void>;
}

export interface AudioEngineOptions {
  /** A context, or how to make one on the first unlock, play or previewNote. */
  context: BaseAudioContext | (() => BaseAudioContext);
  /** The memory manager's budget on the GM tier; `GM_BUDGET_BYTES` by default. */
  budgetBytes?: number;
  /** The budget while `load` is given `tier: 'hq'`; `HQ_BUDGET_BYTES` by default. */
  hqBudgetBytes?: number;
  /** Runs the coalesced memory event; the next animation frame by default. */
  scheduleMemory?: (callback: () => void) => void;
  /** Drives the lookahead scheduler; defaults to a 25 ms interval in a worker. */
  scheduler?: Ticker;
  /** Drives position events; defaults to animation frames. */
  frames?: Ticker;
  /** Seconds of audio scheduled ahead of `currentTime`; 0.2 by default. */
  lookahead?: number;
  /** Seconds between `play` or `seek` and the first sound; 0.03 by default. */
  startLatency?: number;
}

/** The live objects behind an engine, for tests and diagnostics; not part of the contract. */
export interface AudioEngineDebug {
  context?: BaseAudioContext;
  sampler?: Sampler;
  source?: ManagedSampleSource;
  bank?: GmBank;
  transport?: Transport;
  /** The pack assignments that loaded, by track, as `<packId>:<default path>`. */
  assignments?: ReadonlyMap<Id, string>;
}

const debuggers = new WeakMap<AudioEngine, () => AudioEngineDebug>();

export function debugAudioEngine(engine: AudioEngine): AudioEngineDebug {
  return debuggers.get(engine)?.() ?? {};
}

// The manager needs no context: buffers built this way play in any context of their rate.
const CONSTRUCTED_BUFFERS: BufferFactory = {
  createBuffer: (numberOfChannels, length, sampleRate) =>
    new AudioBuffer({ numberOfChannels, length, sampleRate }),
};

function sameTuning(a: Track, b: Track): boolean {
  return (
    a.capo === b.capo &&
    a.tuning.length === b.tuning.length &&
    a.tuning.every((pitch, index) => pitch === b.tuning[index])
  );
}

function checkVolume(method: string, volume: number): void {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError(`${method}: volume must be 0 to 1, got ${String(volume)}`);
  }
}

interface Live {
  context: BaseAudioContext;
  sampler: Sampler;
  transport: Transport;
  click: StandaloneClick;
}

export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  const factory = typeof options.context === 'function' ? options.context : undefined;
  const gmBudgetBytes = options.budgetBytes ?? GM_BUDGET_BYTES;
  const hqBudgetBytes = options.hqBudgetBytes ?? HQ_BUDGET_BYTES;
  let budgetBytes = gmBudgetBytes;

  const handlers: { [K in keyof AudioEngineEvents]: Set<(payload: AudioEngineEvents[K]) => void> } =
    {
      position: new Set(),
      state: new Set(),
      loop: new Set(),
      memory: new Set(),
      instrumentLoads: new Set(),
      click: new Set(),
    };
  let live: Live | undefined;
  let source: ManagedSampleSource | undefined;
  let bank: GmBank | undefined;
  let score: Score | undefined;
  /** The score the sampler's tracks were last built from. */
  let attached: Score | undefined;
  let latestDecode: Promise<LoadResult> | undefined;
  let overrides: Record<Id, TrackParams> = {};
  let tempo: { mode: TempoMode; value: number } = { mode: 'percent', value: 100 };
  let loopBars: { startBar: Id; endBar: Id } | undefined;
  let countIn = false;
  let metronome = { on: false, volume: 0.7 };
  let masterVolume = 1;
  let gmTierBypass = true;
  /** The assignments whose pack loaded, by track: what the tier and the strips follow. */
  let loadedPacks = new Map<Id, { assignment: PackAssignment; key: string }>();
  /** Assignments whose check failed, remembered so an edit does not read a broken pack again. */
  let failedPacks = new Map<Id, { key: string; files: SfzFiles; fallback: LoadFallback }>();
  /** Bumped by every `load`, so a pack check that a newer load overtook changes nothing. */
  let packLoads = 0;
  /** Session stage bypasses, by track. */
  let stageBypasses = new Map<Id, Set<EffectStage>>();
  let clickSettings = DEFAULT_CLICK_SETTINGS;
  let loads: InstrumentLoads = {};
  // Per track, so a second instrument change drops the first one's progress.
  const loadTokens = new Map<Id, number>();
  /** Bumped by `unload`, so loads of an earlier song report nothing. */
  let song = 0;
  let disposed = false;
  const inflight = new Set<Promise<unknown>>();

  function emit<K extends keyof AudioEngineEvents>(event: K, payload: AudioEngineEvents[K]): void {
    const set: Set<(payload: AudioEngineEvents[K]) => void> = handlers[event];
    for (const handler of [...set]) handler(payload);
  }

  function tracked<T>(promise: Promise<T>): Promise<T> {
    const done = promise.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(done);
    void done.then(() => inflight.delete(done));
    return promise;
  }

  function baselineOf(track: Track): Required<TrackParams> {
    const { volume, pan, mute, solo } = track.channel;
    return { volume, pan, mute, solo, ...overrides[track.id] };
  }

  /**
   * Puts every strip back on its track's program and channel, with the user's overrides: a beat's
   * mixer change must not outlive the run it played in. With `at`, volume and pan are scheduled.
   */
  function resetBaseline(at?: number): void {
    if (!live || !bank || !attached) return;
    const { sampler } = live;
    const held = new Set(sampler.trackIds);
    for (const track of attached.tracks) {
      if (!held.has(track.id)) continue;
      sampler.setInstrument(track.id, bank.instrument(track, track.program), at);
      const params = baselineOf(track);
      if (at === undefined) sampler.setTrack(track.id, params);
      else sampler.setTrack(track.id, { volume: params.volume, pan: params.pan }, { at });
    }
  }

  /** Re-resolves every held track's effects; a strip whose chain did not change does nothing. */
  function applyEffects(tracks: readonly Track[]): void {
    if (!live) return;
    const { sampler } = live;
    const held = new Set(sampler.trackIds);
    const assignments = [...loadedPacks.values()].map((entry) => entry.assignment);
    for (const track of tracks) {
      if (!held.has(track.id)) continue;
      const { preset } = resolveEffects(track, { tier: tierOf(track, assignments), gmTierBypass });
      sampler.setEffects(track.id, stagesOf(preset, stageBypasses.get(track.id)));
    }
  }

  function attach(next: Score, mode: 'replace' | 'sync'): void {
    if (!live || !bank) return;
    const { sampler } = live;
    const previous = mode === 'sync' ? attached : undefined;
    const before = new Map(previous?.tracks.map((track) => [track.id, track]));
    const ids = new Set(next.tracks.map((track) => track.id));
    for (const id of sampler.trackIds) {
      if (!previous || !ids.has(id)) sampler.removeTrack(id);
    }
    const held = new Set(sampler.trackIds);
    for (const track of next.tracks) {
      const old = before.get(track.id);
      const base = bank.instrument(track, track.program);
      if (!old || !held.has(track.id) || !sameTuning(old, track)) {
        sampler.addTrack(track, base);
        const override = overrides[track.id];
        if (override) sampler.setTrack(track.id, override);
        continue;
      }
      if (old === track) continue;
      if (old.program !== track.program || old.bank !== track.bank || old.kind !== track.kind) {
        sampler.setInstrument(track.id, base);
      }
      if (old.channel !== track.channel) sampler.setTrack(track.id, baselineOf(track));
    }
    attached = next;
    applyEffects(next.tracks);
  }

  function makeLive(context: BaseAudioContext): Live {
    const sampler = new Sampler(context);
    const sink = createSamplerSink(sampler, {
      instrumentOf: (track, program) => bank?.instrument(track, program),
    });
    const transport = createTransport({
      context,
      sink,
      // Through the bus, so clicks carry the limiter's pre-delay as the notes do.
      metronome: new ClickSynth(context, sampler.master.input),
      ...(options.scheduler && { scheduler: options.scheduler }),
      ...(options.frames && { frames: options.frames }),
      ...(options.lookahead !== undefined && { lookahead: options.lookahead }),
      ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
      // Before the run's first window, so the mixer changes it replays land on top.
      onRunStart: () => {
        resetBaseline();
      },
    });
    transport.setTempo(tempo.mode, tempo.value);
    transport.setCountIn(countIn);
    transport.setMetronome(metronome.on, metronome.volume);
    transport.setLoop(loopBars);
    sampler.master.gain = masterVolume;
    transport.on('state', (state) => {
      if (state === 'stopped') resetBaseline();
      emit('state', state);
    });
    transport.on('position', (position) => {
      emit('position', position);
    });
    transport.on('loop', (loop) => {
      // Emitted before the next pass is scheduled, so its replayed changes win at `when`.
      resetBaseline(loop.when);
      emit('loop', loop);
    });
    const click = createStandaloneClick({
      context,
      sink: new ClickSynth(context, sampler.master.input),
      ...(options.scheduler && { scheduler: options.scheduler }),
      ...(options.lookahead !== undefined && { lookahead: options.lookahead }),
      ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
    });
    live = { context, sampler, transport, click };
    if (score) {
      attach(score, 'replace');
      transport.load(score);
    }
    return live;
  }

  function decode(next: Score): Promise<LoadResult> {
    if (!source || !bank) return Promise.reject(new Error('AudioEngine.load: no sound bank'));
    const decoding = source
      .load(next, bank.regionMap, { instrumentOf: bank.instrumentId })
      .then((plan) => ({ instruments: plan.instruments, fallbacks: [] }));
    latestDecode = decoding;
    return decoding;
  }

  function setLoad(id: Id, load: InstrumentLoad | undefined): void {
    const rest = Object.fromEntries(Object.entries(loads).filter(([key]) => key !== id));
    loads = load ? { ...rest, [id]: load } : rest;
    emit('instrumentLoads', loads);
  }

  /** Decodes one track's samples for its new instrument, counting them into `instrumentLoads`. */
  function loadInstrument(next: Score, id: Id): Promise<void> {
    if (!source || !bank) return Promise.resolve();
    const managed = source;
    const token = (loadTokens.get(id) ?? 0) + 1;
    loadTokens.set(id, token);
    const started = song;
    const current = () => started === song && loadTokens.get(id) === token;
    const plan = planInstruments(next, { instrumentOf: bank.instrumentId });
    const trackPlan = plan.tracks.find((entry) => entry.track === id);
    const refs = trackPlan
      ? planSamples({ instruments: plan.instruments, tracks: [trackPlan] }, bank.regionMap)
      : [];
    if (refs.length === 0) {
      if (current() && id in loads) setLoad(id, undefined);
      return Promise.resolve();
    }
    const total = refs.length;
    let count = 0;
    setLoad(id, { loaded: 0, total });
    return Promise.all(
      refs.map((ref) =>
        managed.getBuffer(ref).then(() => {
          count += 1;
          if (current() && count < total) setLoad(id, { loaded: count, total });
        }),
      ),
    ).then(
      () => {
        if (current()) setLoad(id, undefined);
      },
      (error: unknown) => {
        if (!current()) return;
        setLoad(id, undefined);
        throw error;
      },
    );
  }

  /** A timeline-neutral edit: channel and program changes go straight to the strips. */
  function applyNeutral(previous: Score, next: Score): Promise<LoadResult> {
    if (live) attached = next;
    applyEffects(next.tracks);
    const sampler = live?.sampler;
    const held = new Set(sampler?.trackIds);
    const reprogrammed: Id[] = [];
    next.tracks.forEach((track, index) => {
      const old = previous.tracks[index];
      if (!old || old === track) return;
      if (old.program !== track.program) reprogrammed.push(track.id);
      if (!sampler || !bank || !held.has(track.id)) return;
      if (old.channel !== track.channel) sampler.setTrack(track.id, baselineOf(track));
      if (old.program !== track.program) {
        sampler.setInstrument(track.id, bank.instrument(track, track.program));
      }
    });
    if (reprogrammed.length === 0) return latestDecode ?? decode(next);
    // First: its switchSong pins the new programs before their samples are inserted.
    const decoding = decode(next);
    return Promise.all([decoding, ...reprogrammed.map((id) => loadInstrument(next, id))]).then(
      ([result]) => result,
    );
  }

  /**
   * Checks each assignment against its pack: the default SFZ must read, parse and map a region. An
   * assignment with the same pack id, files object and default path as the last load is not read
   * again, whether it loaded or failed, so a reload swaps only the tracks whose pack changed and a
   * broken pack is not retried on every edit (a reinstall brings a new files object). The provider
   * routing that plays the pack's samples is WP-091 PR A, which should reuse the SFZ parsed here:
   * until then an assignment that checks out changes the track's tier (effects and budget) but not
   * its sound.
   */
  async function resolvePacks(
    next: Score,
    assignments: readonly PackAssignment[],
  ): Promise<{ loaded: typeof loadedPacks; failed: typeof failedPacks }> {
    const tracks = new Set(next.tracks.map((track) => track.id));
    const loaded: typeof loadedPacks = new Map();
    const failed: typeof failedPacks = new Map();
    await Promise.all(
      assignments
        .filter((assignment) => tracks.has(assignment.trackId))
        .map(async (assignment) => {
          const { trackId, pack } = assignment;
          const path = assignment.entries.default;
          const key = `${pack.id}:${path ?? ''}`;
          const ok = loadedPacks.get(trackId);
          if (ok && ok.key === key && ok.assignment.pack.files === pack.files) {
            loaded.set(trackId, { assignment, key });
            return;
          }
          const bad = failedPacks.get(trackId);
          if (bad && bad.key === key && bad.files === pack.files) {
            failed.set(trackId, bad);
            return;
          }
          try {
            if (path === undefined) throw new Error('the assignment has no default entry');
            const { regions } = await loadSfz(path, (file) => pack.files.read(file), {
              packId: pack.id,
            });
            if (regions.length === 0) throw new Error(`${path} maps no regions`);
            loaded.set(trackId, { assignment, key });
          } catch (error) {
            failed.set(trackId, {
              key,
              files: pack.files,
              fallback: {
                trackId,
                packId: pack.id,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }),
    );
    return { loaded, failed };
  }

  function unlock(): Live | undefined {
    if (disposed) return undefined;
    if (!live) {
      if (!factory) return undefined;
      makeLive(factory());
    }
    const context = live?.context;
    if (context instanceof AudioContext && context.state === 'suspended') void context.resume();
    return live;
  }

  function stopClick(): void {
    if (!live?.click.running) return;
    live.click.stop();
    emit('click', false);
  }

  function requireSong(method: string): Score {
    if (!score) throw new Error(`AudioEngine.${method}: load a score first`);
    return score;
  }

  const engine: AudioEngine = {
    load(next, loadOptions) {
      if (disposed) return Promise.reject(new Error('AudioEngine.load: the engine was disposed'));
      if (!source || !bank) {
        return Promise.reject(
          new Error('AudioEngine.load: no sound bank; call setSoundfont first'),
        );
      }
      const previous = score;
      score = next;
      const budget = loadOptions.tier === 'hq' ? hqBudgetBytes : gmBudgetBytes;
      budgetBytes = budget;
      source.budgetBytes = budget;
      const started = packLoads + 1;
      packLoads = started;
      const packing = resolvePacks(next, loadOptions.packs);
      let loading: Promise<LoadResult>;
      if (previous === next) {
        applyEffects(next.tracks);
        loading = decode(next);
      } else if (previous && timelineNeutral(previous, next)) {
        loading = applyNeutral(previous, next);
      } else {
        if (live) {
          attach(next, previous ? 'sync' : 'replace');
          live.transport.load(next);
        }
        loading = decode(next);
      }
      return tracked(
        Promise.all([loading, packing]).then(([result, { loaded, failed }]) => {
          // A newer load, or `unload`, owns the packs now.
          if (packLoads === started && score === next) {
            loadedPacks = loaded;
            failedPacks = failed;
            applyEffects(next.tracks);
          }
          const order = new Map(next.tracks.map((track, index) => [track.id, index]));
          const fallbacks = [...failed.values()]
            .map((entry) => entry.fallback)
            .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
          return { ...result, fallbacks };
        }),
      );
    },

    play(fromTick) {
      requireSong('play');
      const made = unlock();
      if (made) stopClick();
      made?.transport.play(fromTick);
    },

    pause() {
      live?.transport.pause();
    },

    stop() {
      live?.transport.stop();
    },

    seek(tick) {
      if (!live) return;
      requireSong('seek');
      live.transport.seek(tick);
    },

    setTempo(mode, value) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`setTempo: value must be a positive number, got ${String(value)}`);
      }
      tempo = { mode, value };
      live?.transport.setTempo(mode, value);
    },

    setLoop(range) {
      live?.transport.setLoop(range);
      loopBars = range;
    },

    setCountIn(on) {
      countIn = on;
      live?.transport.setCountIn(on);
    },

    setMetronome(on, volume) {
      checkVolume('setMetronome', volume);
      metronome = { on, volume };
      live?.transport.setMetronome(on, volume);
    },

    startClick(settings) {
      if (settings) checkClickSettings('startClick', settings);
      if (disposed) return;
      if (settings) clickSettings = settings;
      const made = unlock();
      if (!made) return;
      if (made.click.running) {
        made.click.update(clickSettings);
        return;
      }
      made.transport.pause();
      made.click.start(clickSettings);
      emit('click', true);
    },

    updateClick(settings) {
      checkClickSettings('updateClick', settings);
      clickSettings = settings;
      if (live?.click.running) live.click.update(settings);
    },

    stopClick() {
      stopClick();
    },

    click() {
      return { running: live?.click.running ?? false, settings: clickSettings };
    },

    setTrack(id, params) {
      overrides = { ...overrides, [id]: { ...overrides[id], ...params } };
      if (live?.sampler.trackIds.includes(id)) live.sampler.setTrack(id, params);
    },

    previewNote(track, note, options) {
      const current = requireSong('previewNote');
      if (!current.tracks.some((entry) => entry.id === track)) {
        throw new RangeError(`AudioEngine.previewNote: the song has no track ${track}`);
      }
      unlock()?.sampler.previewNote(track, note, options);
    },

    on(event, handler) {
      const set: Set<(payload: AudioEngineEvents[typeof event]) => void> = handlers[event];
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    memory() {
      return source?.memory() ?? { decodedBytes: 0, budgetBytes, residents: [] };
    },

    unlock() {
      unlock();
    },

    setSoundfont(font) {
      if (disposed) return;
      if (source) throw new Error('AudioEngine.setSoundfont: the sound bank is already set');
      source = new ManagedSampleSource(font, CONSTRUCTED_BUFFERS, {
        budgetBytes,
        ...(options.scheduleMemory && { schedule: options.scheduleMemory }),
      });
      source.on('memory', (report) => {
        emit('memory', report);
      });
      bank = new GmBank(font, source);
    },

    unload(unloadOptions = {}) {
      if (disposed) return;
      // Its `stopped` resets the baseline while the old song is still attached.
      live?.transport.unload();
      overrides = {};
      stageBypasses = new Map();
      packLoads += 1;
      loadedPacks = new Map();
      failedPacks = new Map();
      loopBars = undefined;
      song += 1;
      loadTokens.clear();
      if (Object.keys(loads).length > 0) {
        loads = {};
        emit('instrumentLoads', loads);
      }
      if (live) for (const id of live.sampler.trackIds) live.sampler.removeTrack(id);
      // A song with no tracks plans no instruments, so the switch evicts every one.
      if (unloadOptions.evict && score && source) source.switchSong({ ...score, tracks: [] });
      score = undefined;
      attached = undefined;
      latestDecode = undefined;
    },

    setMasterVolume(volume) {
      checkVolume('setMasterVolume', volume);
      masterVolume = volume;
      if (live) live.sampler.master.gain = volume;
    },

    setGmTierBypass(on) {
      gmTierBypass = on;
      if (attached) applyEffects(attached.tracks);
    },

    setStageBypass(trackId, stage, bypassed) {
      const stages = new Set(stageBypasses.get(trackId));
      if (bypassed) stages.add(stage);
      else stages.delete(stage);
      stageBypasses = new Map(stageBypasses).set(trackId, stages);
      const track = attached?.tracks.find((entry) => entry.id === trackId);
      if (track) applyEffects([track]);
    },

    previewTrack(id, params) {
      if (live?.sampler.trackIds.includes(id)) live.sampler.setTrack(id, params);
    },

    outputLatency() {
      return outputLatencyOf(live?.context);
    },

    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
      await source?.settled();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      song += 1;
      live?.click.dispose();
      live?.transport.dispose();
      live?.sampler.dispose();
      source?.dispose();
      for (const set of Object.values(handlers)) set.clear();
      const context = live?.context;
      if (factory && context instanceof AudioContext) void context.close();
    },
  };

  debuggers.set(engine, () => ({
    ...(live && { context: live.context, sampler: live.sampler, transport: live.transport }),
    ...(source && { source }),
    ...(bank && { bank }),
    assignments: new Map([...loadedPacks].map(([id, entry]) => [id, entry.key])),
  }));
  if (typeof options.context !== 'function') makeLive(options.context);
  return engine;
}
