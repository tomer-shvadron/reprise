import type { Id, Score, Track } from '@reprise/model';

import { ClickSynth } from './click-synth';
import { GmBank } from './gm-bank';
import { outputLatencyOf } from './output-latency';
import { effectSpecOf } from './effects/presets';
import type { EffectStage } from './effects/presets';
import { Sampler } from './sampler/sampler';
import type { Instrument, PreviewNote, PreviewOptions, TrackParams } from './sampler/sampler';
import { createSamplerSink } from './sampler/sampler-sink';
import { ARTICULATION_SETS, setsOfLayers } from './articulations/sets';
import type { ArticulationSet, PlanVoicing, Voicing } from './articulations/sets';
import {
  DEFAULT_PRELOAD_BARS,
  GM_BUDGET_BYTES,
  HQ_BUDGET_BYTES,
  ManagedSampleSource,
} from './samples/managed-sample-source';
import type { BufferFactory } from './samples/managed-sample-source';
import { planInstruments, planSamples } from './samples/plan';
import { ProviderRouter, packInstrumentId } from './samples/provider-router';
import type { InstrumentId, MemoryReport } from './samples/types';
import type { Sf2Soundfont } from './sf2/soundfont';
import { loadSfz } from './sfz/load';
import { SfzPack } from './sfz/pack';
import type { SfzFiles } from './sfz/pack';
import type { SfzLayer } from './sfz/resolve';
import type { RegionMap } from './sampler/region-map';
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
   * SFZ paths inside the pack by articulation-set key (`ARTICULATION_SETS`). `default` is
   * required and is what plays; the other keys name the sets a pack has a file for, and a key
   * outside the list is ignored (WP-093 maps them to notes).
   */
  entries: Readonly<Record<string, string>>;
}

export interface LoadOptions {
  /**
   * Selects the memory budget: the setting (`setMemoryBudget`, `hqBudgetBytes` at first) on `hq`,
   * and the smaller of it and `budgetBytes` on `gm`.
   */
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
  /** 0 to 1; the level of the count-in clicks, apart from the metronome's. */
  setCountInVolume(volume: number): void;
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
  /**
   * One beat of the song as it is written, effects included (bends, slides, vibrato, palm mute,
   * golpe, wah, harmonics, grace notes, ties), planned by the scheduler that plans playback and
   * sounded now through the track's strip, past mute and solo, while stopped or playing. It
   * takes no options: the beat's own dynamics, tempo and notes, the last strike sounding at least
   * 0.6 s and a let-ring note ringing to its end, capped at 2 s. Previews choke only previews and
   * never touch the song's voices, mixer, round robins or pedal (the wah has a preview pedal). A
   * rest is silent, as is a beat in a bar playback never reaches; a sample not yet decoded is
   * requested and misses this once, as in playback. Throws a plain `Error` with no song loaded
   * and a `RangeError` for a track or beat the song lacks, and unlocks the context.
   */
  previewBeat(track: Id, beat: Id): void;
  on<K extends keyof AudioEngineEvents>(
    event: K,
    handler: (payload: AudioEngineEvents[K]) => void,
  ): Unsubscribe;
  memory(): MemoryReport;
  /**
   * The "Memory for sounds" setting, applied at once: the effective budget is `bytes` on the HQ
   * tier and the smaller of it and the GM budget on the GM tier, and `memory().budgetBytes`
   * reports it. Lowering it evicts down to it; raising it decodes the loaded song's missing
   * samples again if all of them fit. Called before `setSoundfont`, it is applied then. Throws a
   * `RangeError` for a value that is not a finite, non-negative byte count.
   */
  setMemoryBudget(bytes: number): void;
  /**
   * Frees the instruments the open song does not use (`memory().unused`) and returns how many;
   * with no song loaded, every resident.
   */
  unloadUnused(): number;
  dispose(): void;
  /** Makes the context on the first call, from the factory; resumes a suspended one after. */
  unlock(): void;
  setSoundfont(font: Sf2Soundfont): void;
  /**
   * Ends the song; `evict` frees every instrument too, as closing it should. A sample fetch
   * already in flight (a pack check's probe) can still land afterwards as a leftover resident.
   */
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
   * Whether the file's channel reverb and chorus (CC91 and CC93, `channel.reverb` and
   * `channel.chorus`) drive the strip's reverb send and a chorus stage (on by default). They
   * apply only where no preset does: a GM-tier track on the automatic path with the GM tier
   * bypass on. A preset owns the reverb and chorus wherever one applies, `off` included, on the
   * HQ tier and on a GM track with the bypass off. `setStageBypass` drops the part like a
   * preset's. Applies to a loaded song at once.
   */
  setChannelEffects(on: boolean): void;
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
  /** The memory setting at first, used on the HQ tier; `HQ_BUDGET_BYTES` by default. */
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
  /** The packs the router can fetch from, by install (`<packId>@<n>`). */
  packs?: readonly string[];
  /** Per track, the `entries` keys of its pack that are not played: not a set, or a file that failed. */
  skippedEntries?: ReadonlyMap<Id, readonly string[]>;
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
    a.tuning.every((pitch, index) => pitch === b.tuning[index]) &&
    a.courses?.length === b.courses?.length &&
    (a.courses ?? []).every((offset, index) => offset === b.courses?.[index])
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('AudioEngine.load: no sound bank; call setSoundfont first');
  return value;
}

function checkVolume(method: string, volume: number): void {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError(`${method}: volume must be 0 to 1, got ${String(volume)}`);
  }
}

/** A pack assignment whose default SFZ parsed: the instrument its track plays. */
interface LoadedPack {
  assignment: PackAssignment;
  key: string;
  /** `key` and every other entry: a change in any of them loads the track again. */
  signature: string;
  id: InstrumentId;
  instrument: Instrument;
  regions: RegionMap;
  /** The pack object behind the router, for this install of the files. */
  sfz: SfzPack;
  /** What the pack offers beyond its default instrument, for the sink. */
  voicing: Voicing;
  /** The same table as ids, for the planner. */
  planned: PlanVoicing;
  /** The region maps of the pack's per-file sets, by instrument id. */
  setMaps: ReadonlyMap<InstrumentId, RegionMap>;
  /** The `entries` keys ignored (not a set) or dropped (their file failed), for `debugAudioEngine`. */
  skipped: readonly string[];
}

/** A parsed default SFZ of one install: shared by every track and load that names it. */
interface ParsedEntry {
  id: InstrumentId;
  regions: RegionMap;
  sfz: SfzPack;
  layers: SfzLayer[];
}

let installCount = 0;
const installIds = new WeakMap<SfzFiles, number>();

/**
 * The install a files object stands for. Sample refs and instrument ids carry it
 * (`<packId>@<n>`), so a reinstall under the same pack id, an old fetch still in flight and the
 * buffers a removed pack left behind can never answer for the new files.
 */
function installOf(files: SfzFiles): number {
  let id = installIds.get(files);
  if (id === undefined) {
    installCount += 1;
    id = installCount;
    installIds.set(files, id);
  }
  return id;
}

interface Live {
  context: BaseAudioContext;
  sampler: Sampler;
  transport: Transport;
  click: StandaloneClick;
}

function checkBudget(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`setMemoryBudget: ${String(bytes)} is not a non-negative byte count`);
  }
  return bytes;
}

export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  const factory = typeof options.context === 'function' ? options.context : undefined;
  const gmBudgetBytes = options.budgetBytes ?? GM_BUDGET_BYTES;
  let memorySetting = checkBudget(options.hqBudgetBytes ?? HQ_BUDGET_BYTES);
  let tier: LoadOptions['tier'] = 'gm';
  const effectiveBudget = (): number =>
    tier === 'hq' ? memorySetting : Math.min(memorySetting, gmBudgetBytes);
  let budgetBytes = effectiveBudget();

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
  let router: ProviderRouter | undefined;
  let score: Score | undefined;
  /** The score the sampler's tracks were last built from. */
  let attached: Score | undefined;
  /** The last score whose load got past its pack check: what the next load is an edit of. */
  let committed: Score | undefined;
  let latestDecode: Promise<LoadResult> | undefined;
  let overrides: Record<Id, TrackParams> = {};
  let tempo: { mode: TempoMode; value: number } = { mode: 'percent', value: 100 };
  let loopBars: { startBar: Id; endBar: Id } | undefined;
  let countIn = false;
  let metronome = { on: false, volume: 0.7 };
  let countInVolume = 0.7;
  let masterVolume = 1;
  let gmTierBypass = true;
  let channelEffectsOn = true;
  /** The assignments whose pack loaded, by track: what the tier and the strips follow. */
  let loadedPacks = new Map<Id, LoadedPack>();
  /**
   * Per files object (an install), its one `SfzPack` and the default SFZ of each path, parsed once
   * and shared by tracks and by overlapping loads. A parse that fails is dropped, so the next load
   * retries it; `failedPacks` is what remembers a failure. Keyed by identity, so a stale check
   * cannot leak into a reinstall; cleared by `unload`.
   */
  let installs = new WeakMap<
    SfzFiles,
    { sfz: SfzPack; parses: Map<string, Promise<ParsedEntry>> }
  >();
  /** Assignments whose check failed, remembered so an edit does not read a broken pack again. */
  let failedPacks = new Map<Id, { key: string; files: SfzFiles; fallback: LoadFallback }>();
  /** Bumped by every `load`, so a pack check that a newer load overtook changes nothing. */
  let packLoads = 0;
  /** Pending while the latest load waits on a pack's SFZ and has not attached its song. */
  let attaching = false;
  /** A `play` asked for while the latest load had not attached its song. */
  let pendingPlay: { tick: number | undefined } | undefined;
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

  /**
   * The one answer to "which instrument" for a track: its pack instrument when an assignment
   * loaded, whatever the program (a pack is the track's sound, so a beat's program change does
   * not leave it), else the GM preset.
   */
  function instrumentFor(track: Track, program: number): Instrument | undefined {
    return loadedPacks.get(track.id)?.instrument ?? bank?.instrument(track, program);
  }

  const instrumentIdFor = (track: Track, program: number): InstrumentId => {
    const packed = loadedPacks.get(track.id);
    if (packed) return packed.id;
    if (!bank) throw new Error('AudioEngine: no sound bank');
    return bank.instrumentId(track, program);
  };

  /** How the planner places a song's notes: the track's instrument, and each set's file or layer. */
  const planOptions = {
    instrumentOf: instrumentIdFor,
    voicingFor: (track: Track): PlanVoicing | undefined => loadedPacks.get(track.id)?.planned,
  };

  const regionMapOf = (id: InstrumentId): RegionMap | undefined => {
    for (const entry of loadedPacks.values()) {
      if (entry.id === id) return entry.regions;
      const own = entry.setMaps.get(id);
      if (own) return own;
    }
    return bank?.regionMap(id);
  };

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
      const instrument = instrumentFor(track, track.program);
      if (instrument) sampler.setInstrument(track.id, instrument, at);
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
      const spec = effectSpecOf(
        track,
        { tier: tierOf(track, assignments), gmTierBypass, channelEffects: channelEffectsOn },
        stageBypasses.get(track.id),
      );
      sampler.setEffects(track.id, spec);
    }
  }

  function attach(next: Score, mode: 'replace' | 'sync', swapped: ReadonlySet<Id>): void {
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
      const base = instrumentFor(track, track.program);
      if (!base) continue;
      if (!old || !held.has(track.id) || !sameTuning(old, track)) {
        sampler.addTrack(track, base);
        const override = overrides[track.id];
        if (override) sampler.setTrack(track.id, override);
        continue;
      }
      if (
        old.program !== track.program ||
        old.bank !== track.bank ||
        old.kind !== track.kind ||
        swapped.has(track.id)
      ) {
        sampler.setInstrument(track.id, base);
      }
      if (old === track) continue;
      if (old.channel !== track.channel) sampler.setTrack(track.id, baselineOf(track));
    }
    attached = next;
    applyEffects(next.tracks);
  }

  function makeLive(context: BaseAudioContext): Live {
    const sampler = new Sampler(context);
    const sink = createSamplerSink(sampler, {
      // An HQ track keeps its pack through a beat's program change.
      instrumentOf: (track, program) =>
        loadedPacks.has(track.id) ? undefined : bank?.instrument(track, program),
      voicingFor: (track) => loadedPacks.get(track.id)?.voicing,
    });
    const transport = createTransport({
      context,
      sink,
      // Through the bus, so clicks carry the limiter's pre-delay as the notes do.
      metronome: new ClickSynth(context, sampler.master.input),
      countIn: new ClickSynth(context, sampler.master.input),
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
    transport.setCountInVolume(countInVolume);
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
      attach(score, 'replace', new Set());
      transport.load(score);
    }
    return live;
  }

  function decode(next: Score): Promise<LoadResult> {
    if (!source || !bank) return Promise.reject(new Error('AudioEngine.load: no sound bank'));
    const decoding = source
      .load(next, regionMapOf, planOptions)
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
    const plan = planInstruments(next, planOptions);
    const trackPlan = plan.tracks.find((entry) => entry.track === id);
    const refs = trackPlan
      ? planSamples({ instruments: plan.instruments, tracks: [trackPlan] }, regionMapOf)
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

  /**
   * A timeline-neutral edit: channel and program changes go straight to the strips, and a track
   * whose pack instrument changed takes the new one.
   */
  function applyNeutral(
    previous: Score,
    next: Score,
    swapped: ReadonlySet<Id>,
  ): Promise<LoadResult> {
    if (live) attached = next;
    applyEffects(next.tracks);
    const sampler = live?.sampler;
    const held = new Set(sampler?.trackIds);
    const reprogrammed = new Set<Id>();
    next.tracks.forEach((track, index) => {
      const old = previous.tracks[index];
      if (!old) return;
      const resample = swapped.has(track.id);
      if (old === track && !resample) return;
      // A pack instrument ignores the program, so only a GM track decodes for one.
      if (resample || (old.program !== track.program && !loadedPacks.has(track.id))) {
        reprogrammed.add(track.id);
      }
      if (!sampler || !held.has(track.id)) return;
      if (old.channel !== track.channel) sampler.setTrack(track.id, baselineOf(track));
      if (resample || old.program !== track.program) {
        const instrument = instrumentFor(track, track.program);
        if (instrument) sampler.setInstrument(track.id, instrument);
      }
    });
    if (reprogrammed.size === 0) return latestDecode ?? decode(next);
    // First: its switchSong pins the new programs before their samples are inserted.
    const decoding = decode(next);
    return Promise.all([decoding, ...[...reprogrammed].map((id) => loadInstrument(next, id))]).then(
      ([result]) => result,
    );
  }

  /**
   * After the opening bars failed to decode: loads those bars' samples of each pack track on its
   * own (what already decoded is resident, so only the failing samples are fetched again), and
   * sends the tracks whose pack cannot supply them (a missing or corrupt sample file) back to
   * General MIDI, reported as fallbacks. Changes nothing, and resolves `undefined`, once
   * `current()` is false, so an overtaken load never touches the sampler.
   */
  async function dropBrokenPacks(
    next: Score,
    loaded: Map<Id, LoadedPack>,
    failed: Map<Id, { key: string; files: SfzFiles; fallback: LoadFallback }>,
    current: () => boolean,
  ): Promise<number | undefined> {
    const managed = source;
    if (!managed) return 0;
    const probes = await Promise.all(
      [...loaded].map(async ([id, entry]) => {
        const track = next.tracks.find((candidate) => candidate.id === id);
        if (!track) return undefined;
        const plan = planInstruments(
          { ...next, tracks: [track] },
          { ...planOptions, bars: DEFAULT_PRELOAD_BARS },
        );
        const refs = planSamples(plan, regionMapOf);
        const results = await Promise.allSettled(refs.map((ref) => managed.getBuffer(ref)));
        const bad = results.find((result) => result.status === 'rejected');
        return bad ? { id, entry, track, reason: bad.reason as unknown } : undefined;
      }),
    );
    if (!current()) return undefined;
    let dropped = 0;
    for (const probe of probes) {
      if (!probe || loaded.get(probe.id) !== probe.entry) continue;
      const { id, entry, track, reason } = probe;
      loaded.delete(id);
      failed.set(id, {
        key: entry.key,
        files: entry.assignment.pack.files,
        fallback: {
          trackId: id,
          packId: entry.assignment.pack.id,
          error: reason instanceof Error ? reason.message : String(reason),
        },
      });
      const instrument = bank?.instrument(track, track.program);
      if (live?.sampler.trackIds.includes(id) && instrument) {
        live.sampler.setInstrument(id, instrument);
      }
      applyEffects([track]);
      dropped += 1;
    }
    return dropped;
  }

  type Resolved = { loaded: Map<Id, LoadedPack>; failed: typeof failedPacks };

  function parseEntry(pack: PackAssignment['pack'], path: string): Promise<ParsedEntry> {
    let install = installs.get(pack.files);
    if (!install) {
      const key = `${pack.id}@${String(installOf(pack.files))}`;
      install = { sfz: new SfzPack({ id: key, files: pack.files }), parses: new Map() };
      installs.set(pack.files, install);
    }
    const { sfz, parses } = install;
    let parsing = parses.get(path);
    if (!parsing) {
      const own = (async () => {
        const parsed = await loadSfz(path, (file) => pack.files.read(file), { packId: sfz.id });
        if (parsed.regions.length === 0) throw new Error(`${path} maps no regions`);
        const id = packInstrumentId(sfz.id, path);
        const adopted = sfz.adopt(parsed, { id });
        return { id, sfz, regions: adopted.regions, layers: adopted.layers };
      })();
      parsing = own;
      parses.set(path, own);
      own.catch(() => {
        if (parses.get(path) === own) parses.delete(path);
      });
    }
    return parsing;
  }

  /** The assignment's whole `entries`, in key order: any change to it loads the track again. */
  function signatureOf({ pack, entries }: PackAssignment): string {
    const rest = Object.keys(entries)
      .filter((set) => set !== 'default')
      .sort()
      .map((set) => `|${set}=${entries[set] ?? ''}`);
    return `${pack.id}:${entries.default ?? ''}${rest.join('')}`;
  }

  /**
   * The sets a pack has beyond its default: each `entries.<set>` file becomes an instrument of
   * its own, and a labelled keyswitch layer of the default file names a set too, an explicit file
   * winning. A file that fails drops only its set, and a key that names no set is ignored; both
   * are listed for `debugAudioEngine` and nothing else.
   */
  async function resolveSets(assignment: PackAssignment, layers: readonly SfzLayer[]) {
    const { pack, entries } = assignment;
    const voicing: Voicing['sets'] = {};
    const planned: PlanVoicing = {};
    const ids: { id: InstrumentId; regions: RegionMap }[] = [];
    const skipped: string[] = [];
    const named = Object.keys(entries)
      .filter((set) => set !== 'default')
      .sort();
    await Promise.all(
      named.map(async (name) => {
        const path = entries[name];
        const set = ARTICULATION_SETS.find((known) => known === name);
        if (set === undefined || path === undefined) {
          skipped.push(name);
          return;
        }
        try {
          const parsed = await parseEntry(pack, path);
          voicing[set] = { instrument: { regions: parsed.regions, source: required(source) } };
          planned[set] = { instrument: parsed.id };
          ids.push({ id: parsed.id, regions: parsed.regions });
        } catch {
          skipped.push(name);
        }
      }),
    );
    for (const [set, found] of Object.entries(setsOfLayers(layers))) {
      const known: ArticulationSet | undefined = ARTICULATION_SETS.find((name) => name === set);
      if (known === undefined || voicing[known] || !found.layer) continue;
      voicing[known] = found;
      planned[known] = { layer: found.layer };
    }
    return {
      voicing,
      planned,
      ids,
      maps: ids.map((entry) => entry.regions),
      skipped: skipped.sort(),
    };
  }

  /**
   * Checks each assignment against its pack: the default SFZ must read, parse and map a region,
   * and that parse becomes the track's instrument (the file is read once). An assignment with the
   * same pack id, files object and default path as the last load is not read again, whether it
   * loaded or failed, so a reload swaps only the tracks whose pack changed and a broken pack is
   * not retried on every edit (a reinstall brings a new files object). Synchronous when every
   * assignment is already known.
   */
  function resolvePacks(
    next: Score,
    assignments: readonly PackAssignment[],
  ): Resolved | Promise<Resolved> {
    const tracks = new Set(next.tracks.map((track) => track.id));
    const loaded: Resolved['loaded'] = new Map();
    const failed: Resolved['failed'] = new Map();
    const unknown: PackAssignment[] = [];
    for (const assignment of assignments) {
      if (!tracks.has(assignment.trackId)) continue;
      const { trackId, pack } = assignment;
      const signature = signatureOf(assignment);
      const ok = loadedPacks.get(trackId);
      if (ok && ok.signature === signature && ok.assignment.pack.files === pack.files) {
        loaded.set(trackId, { ...ok, assignment });
        continue;
      }
      const bad = failedPacks.get(trackId);
      if (bad && bad.key === signature && bad.files === pack.files) {
        failed.set(trackId, bad);
        continue;
      }
      unknown.push(assignment);
    }
    if (unknown.length === 0) return { loaded, failed };
    return Promise.all(
      unknown.map(async (assignment) => {
        const { trackId, pack } = assignment;
        const path = assignment.entries.default;
        const key = `${pack.id}:${path ?? ''}`;
        try {
          if (path === undefined) throw new Error('the assignment has no default entry');
          const { id, regions, sfz, layers } = await parseEntry(pack, path);
          const sets = await resolveSets(assignment, layers);
          const hasLegato =
            regions.hasLegatoRegions || sets.maps.some((map) => map.hasLegatoRegions);
          loaded.set(trackId, {
            assignment,
            key,
            signature: signatureOf(assignment),
            id,
            regions,
            sfz,
            instrument: { regions, source: required(source) },
            voicing: { sets: sets.voicing, legatoTrigger: hasLegato },
            planned: sets.planned,
            setMaps: new Map(sets.ids.map(({ id: setId, regions: map }) => [setId, map])),
            skipped: sets.skipped,
          });
        } catch (error) {
          failed.set(trackId, {
            key: signatureOf(assignment),
            files: pack.files,
            fallback: {
              trackId,
              packId: pack.id,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }),
    ).then(() => ({ loaded, failed }));
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
      score = next;
      tier = loadOptions.tier;
      budgetBytes = effectiveBudget();
      source.budgetBytes = budgetBytes;
      const started = packLoads + 1;
      packLoads = started;
      // A newer load, or `unload`, owns the song and the packs once this is false.
      const current = () => packLoads === started && score === next;
      const overtaken = (): Promise<LoadResult> =>
        (latestDecode ?? Promise.resolve({ instruments: [], fallbacks: [] })).then((result) => ({
          ...result,
          fallbacks: [],
        }));
      const run = ({ loaded, failed }: Resolved): Promise<LoadResult> => {
        if (!current()) return overtaken();
        attaching = false;
        const swapped = new Set<Id>();
        for (const id of new Set([...loadedPacks.keys(), ...loaded.keys()])) {
          if (loadedPacks.get(id)?.instrument !== loaded.get(id)?.instrument) swapped.add(id);
        }
        loadedPacks = loaded;
        failedPacks = failed;
        router?.setPacks(new Map([...loaded.values()].map((entry) => [entry.sfz.id, entry.sfz])));
        const previous = committed;
        committed = next;
        let loading: Promise<LoadResult>;
        if (previous === next) {
          applyEffects(next.tracks);
          const held = live ? new Set(live.sampler.trackIds) : new Set<Id>();
          const changed = next.tracks.filter(
            (track) => swapped.has(track.id) && held.has(track.id),
          );
          for (const track of changed) {
            const instrument = instrumentFor(track, track.program);
            if (instrument) live?.sampler.setInstrument(track.id, instrument);
          }
          // First: its switchSong pins the pack instruments before their samples are inserted.
          const decoding = decode(next);
          loading = Promise.all([
            decoding,
            ...changed.map((track) => loadInstrument(next, track.id)),
          ]).then(([result]) => result);
        } else if (previous && timelineNeutral(previous, next)) {
          loading = applyNeutral(previous, next, swapped);
        } else {
          if (live) {
            attach(next, previous ? 'sync' : 'replace', swapped);
            live.transport.load(next);
          }
          loading = decode(next);
        }
        const pending = pendingPlay;
        pendingPlay = undefined;
        if (pending) live?.transport.play(pending.tick);
        const recovering = loading.catch(async (error: unknown) => {
          // A pack whose samples will not decode plays GM; any other failure is the caller's.
          if (!current()) return overtaken();
          const dropped = await dropBrokenPacks(next, loaded, failed, current);
          if (dropped === undefined) return overtaken();
          if (dropped === 0) throw error;
          if (!current()) return overtaken();
          return decode(next);
        });
        const order = new Map(next.tracks.map((track, index) => [track.id, index]));
        return recovering.then((result) => ({
          ...result,
          fallbacks: [...failed.values()]
            .map((entry) => entry.fallback)
            .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0)),
        }));
      };
      const resolution = resolvePacks(next, loadOptions.packs);
      if (!(resolution instanceof Promise)) return tracked(run(resolution));
      // Until `run` attaches, the sampler and transport hold the previous song.
      attaching = true;
      const loading = resolution.then(run);
      return tracked(loading);
    },

    play(fromTick) {
      requireSong('play');
      const made = unlock();
      if (made) stopClick();
      if (attaching) {
        // The transport still holds the previous song: the load that attaches this one starts it.
        pendingPlay = { tick: fromTick };
        return;
      }
      made?.transport.play(fromTick);
    },

    pause() {
      pendingPlay = undefined;
      live?.transport.pause();
    },

    stop() {
      pendingPlay = undefined;
      live?.transport.stop();
    },

    seek(tick) {
      if (!live) return;
      requireSong('seek');
      if (pendingPlay) pendingPlay = { tick };
      else live.transport.seek(tick);
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

    setCountInVolume(volume) {
      checkVolume('setCountInVolume', volume);
      countInVolume = volume;
      live?.transport.setCountInVolume(volume);
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
      pendingPlay = undefined;
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
      // A track that is new in the score is not in the sampler until its pack's SFZ has been read.
      const made = unlock();
      if (made?.sampler.trackIds.includes(track)) made.sampler.previewNote(track, note, options);
    },

    previewBeat(track, beat) {
      const current = requireSong('previewBeat');
      const found = current.tracks.find((entry) => entry.id === track);
      if (!found) throw new RangeError(`AudioEngine.previewBeat: the song has no track ${track}`);
      const exists = found.bars.some((bar) =>
        bar.voices.some((voice) => voice.beats.some((entry) => entry.id === beat)),
      );
      if (!exists)
        throw new RangeError(`AudioEngine.previewBeat: track ${track} has no beat ${beat}`);
      // The transport holds the song the sampler was built for; until a queued rebuild attaches
      // the new one it does not know a beat added since, and stays silent.
      unlock()?.transport.previewBeat(track, beat);
    },

    on(event, handler) {
      const set: Set<(payload: AudioEngineEvents[typeof event]) => void> = handlers[event];
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    memory() {
      return (
        source?.memory() ?? {
          decodedBytes: 0,
          budgetBytes,
          residents: [],
          unused: [],
          shortfall: false,
        }
      );
    },

    setMemoryBudget(bytes) {
      memorySetting = checkBudget(bytes);
      const raised = effectiveBudget() > budgetBytes;
      budgetBytes = effectiveBudget();
      if (!source) return;
      source.budgetBytes = budgetBytes;
      // While a load's pack check runs the source still holds the previous song's plan.
      if (raised && score && !attaching) source.warm(regionMapOf);
    },

    unloadUnused() {
      return source?.evictUnused() ?? 0;
    },

    unlock() {
      unlock();
    },

    setSoundfont(font) {
      if (disposed) return;
      if (source) throw new Error('AudioEngine.setSoundfont: the sound bank is already set');
      router = new ProviderRouter(font);
      source = new ManagedSampleSource(router, CONSTRUCTED_BUFFERS, {
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
      attaching = false;
      pendingPlay = undefined;
      installs = new WeakMap();
      loadedPacks = new Map();
      failedPacks = new Map();
      router?.setPacks(new Map());
      committed = undefined;
      loopBars = undefined;
      song += 1;
      loadTokens.clear();
      if (Object.keys(loads).length > 0) {
        loads = {};
        emit('instrumentLoads', loads);
      }
      if (live) for (const id of live.sampler.trackIds) live.sampler.removeTrack(id);
      source?.unpin();
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

    setChannelEffects(on) {
      channelEffectsOn = on;
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
    skippedEntries: new Map([...loadedPacks].map(([id, entry]) => [id, entry.skipped])),
    ...(router && { packs: router.packIds() }),
  }));
  if (typeof options.context !== 'function') makeLive(options.context);
  return engine;
}
