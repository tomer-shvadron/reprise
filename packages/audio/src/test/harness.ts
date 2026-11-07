/**
 * The offline harness: a score rendered through the real transport, scheduler, articulations and
 * sampler into an `OfflineAudioContext`, with GeneralUser GS behind the GM tier or any
 * instrument a test supplies. What to listen for is in `./signal`.
 */
import type { Id, Score, Track } from '@reprise/model';
import { secondsAtTick } from '@reprise/model';

import { ClickSynth } from '../click-synth';
import { createTransport } from '../transport';
import type { Transport } from '../transport';
import { drive, manualTicker } from '../offline-driver';
import type { RegionMap, SampleRef } from '../sampler/region-map';
import { Sampler } from '../sampler/sampler';
import type { Instrument } from '../sampler/sampler';
import { createSamplerSink } from '../sampler/sampler-sink';
import { GM_BUDGET_BYTES, ManagedSampleSource } from '../samples/managed-sample-source';
import type { InstrumentId } from '../samples/types';
import { PERCUSSION_BANK, Sf2Soundfont } from '../sf2/soundfont';
import type { InstrumentSink, NoteEvent } from '../sink';
import { createTimeline } from '../timeline';
import { signalOf } from './signal';
import type { Signal } from './signal';

export const SAMPLE_RATE = 44_100;

/** Playback starts this long after `play`: at 120 BPM, quarter `k` sounds at `START + k / 2`. */
export const START = 0.1;

// Fetched by `pnpm sounds:fetch`, never committed. Vitest's browser server serves the repo.
const GENERAL_USER = new URL(
  '../../../../apps/web/public/sounds/gm/GeneralUser-GS.sf2',
  import.meta.url,
);

/** GeneralUser GS's bytes; `undefined` until `pnpm sounds:fetch` has run. */
export async function loadGeneralUserBytes(): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(GENERAL_USER);
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A dev server may answer a missing file with its HTML fallback rather than a 404.
    return String.fromCodePoint(...bytes.subarray(0, 4)) === 'RIFF' ? bytes : undefined;
  } catch {
    return undefined;
  }
}

let generalUser: Promise<Sf2Soundfont | undefined> | undefined;

/** GeneralUser GS, parsed once per test file; `undefined` until `pnpm sounds:fetch` has run. */
export function loadGeneralUser(): Promise<Sf2Soundfont | undefined> {
  generalUser ??= loadGeneralUserBytes().then((bytes) => bytes && Sf2Soundfont.parse(bytes));
  return generalUser;
}

/** The bank and program a GM player picks for a track: drum kits live in the percussion bank. */
function presetOf(track: Pick<Track, 'kind' | 'bank'>, program: number): [number, number] {
  return track.kind === 'drums' ? [PERCUSSION_BANK, program] : [track.bank, program];
}

export interface RenderOptions {
  /**
   * Where the notes come from: a soundfont plays each track's GM preset through the memory
   * manager, switching preset at each program change; a function supplies the instrument per track.
   */
  instruments: Sf2Soundfont | ((track: Track) => Instrument);
  /** Rendered length; the song plus `tail` by default. */
  seconds?: number;
  /** Seconds after the last bar ends, for releases and let-ring. */
  tail?: number;
  sampleRate?: number;
  /**
   * `master` records the whole output (bus pre-delay and limiter included); `strips` the
   * strips' sum before the bus, so levels and onset times are the sampler's own.
   */
  tap?: 'master' | 'strips';
  metronome?: boolean;
  /** Calls into the engine at a context time, run at the first suspension after it. */
  actions?: readonly { at: number; run: (engine: Transport) => void }[];
}

/** A note the sampler skipped because its sample was not decoded. */
export interface Miss {
  track: Id;
  sample: SampleRef;
}

/** One `Sampler.noteOn` call. */
export interface Strike {
  track: Id;
  key: number;
  velocity: number;
  when: number;
  /** A voice started. */
  sounded: boolean;
  /** No voice started because a sample was not decoded (also in `missed`). */
  missedSample: boolean;
}

export interface Rendered extends Signal {
  buffer: AudioBuffer;
  sampler: Sampler;
  missed: Miss[];
  /** Every note the transport handed the sink, in order. */
  scheduled: NoteEvent[];
  /** Every key the sink struck on the sampler, with whether a region sounded it. */
  strikes: Strike[];
  /** The strikes each scheduled note made, aligned with `scheduled` (a carried legato voice makes none). */
  struck: Strike[][];
  /** The memory manager, when a soundfont played. */
  source: ManagedSampleSource | undefined;
  /** Seconds of the song at its written tempo, from `START`. */
  songSeconds: number;
}

/** The song's length at its written tempo, every repeat and jump played. */
export function songSeconds(score: Score): number {
  const timeline = createTimeline(score);
  return secondsAtTick(timeline.map, timeline.endTick);
}

/** Every sample the whole song can reach, decoded before rendering starts, as an offline render needs. */
async function gmInstruments(
  score: Score,
  soundfont: Sf2Soundfont,
  context: BaseAudioContext,
): Promise<{
  source: ManagedSampleSource;
  instrumentOf: (track: Track) => Instrument;
  programOf: (track: Track, program: number) => Instrument | undefined;
}> {
  const source = new ManagedSampleSource(soundfont, context, {
    budgetBytes: GM_BUDGET_BYTES,
    schedule: () => undefined,
  });
  const maps = new Map<InstrumentId, RegionMap>();
  const instrumentOf = (track: Pick<Track, 'kind' | 'bank'>, program: number): InstrumentId => {
    const [bank, preset] = presetOf(track, program);
    const resolved = soundfont.resolve(bank, preset);
    if (!resolved) throw new Error(`no preset at bank ${String(bank)} program ${String(preset)}`);
    const map = soundfont.regionMapFor(bank, preset);
    if (map) maps.set(resolved.id, map);
    return resolved.id;
  };
  await source.load(score, (id) => maps.get(id), {
    bars: Number.MAX_SAFE_INTEGER,
    warm: false,
    instrumentOf,
  });
  await source.settled();
  const programOf = (track: Track, program: number): Instrument | undefined => {
    const regions = maps.get(instrumentOf(track, program));
    return regions && { regions, source };
  };
  return {
    source,
    instrumentOf: (track) => {
      const instrument = programOf(track, track.program);
      if (!instrument) throw new Error(`no region map for track ${track.name}`);
      return instrument;
    },
    programOf,
  };
}

/**
 * Loads `score` into a fresh transport over the real sampler, presses play at time 0 and renders.
 * The scheduler and position timers fire at every 1024-frame suspension, so timing is
 * deterministic; the samples match across runs only to within float jitter (about 2e-6).
 */
export async function renderScore(score: Score, options: RenderOptions): Promise<Rendered> {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const song = songSeconds(score);
  const seconds = options.seconds ?? START + song + (options.tail ?? 1);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.max(1, Math.round(seconds * sampleRate)),
    sampleRate,
  });
  let source: ManagedSampleSource | undefined;
  let instrumentOf: (track: Track) => Instrument;
  let programOf: ((track: Track, program: number) => Instrument | undefined) | undefined;
  if (options.instruments instanceof Sf2Soundfont) {
    ({ source, instrumentOf, programOf } = await gmInstruments(
      score,
      options.instruments,
      context,
    ));
  } else {
    instrumentOf = options.instruments;
  }
  const missed: Miss[] = [];
  const sampler = new Sampler(context, {
    onMiss: (track, sample) => missed.push({ track, sample }),
  });
  const strikes: Strike[] = [];
  const noteOn = sampler.noteOn.bind(sampler);
  // The sampler returns no handle when no region matches, so this is the only place to see it.
  sampler.noteOn = (track, request) => {
    const misses = missed.length;
    const handle = noteOn(track, request);
    strikes.push({
      track,
      key: request.key,
      velocity: request.velocity,
      when: request.when,
      sounded: handle !== undefined,
      missedSample: missed.length > misses,
    });
    return handle;
  };
  if (options.tap === 'strips') {
    sampler.master.input.disconnect();
    sampler.master.input.connect(context.destination);
  }
  for (const track of score.tracks) sampler.addTrack(track, instrumentOf(track));
  const scheduler = manualTicker();
  const frames = manualTicker();
  const scheduled: NoteEvent[] = [];
  const struck: Strike[][] = [];
  const samplerSink = createSamplerSink(sampler, programOf ? { instrumentOf: programOf } : {});
  const sink: InstrumentSink = {
    noteOn(event) {
      scheduled.push(event);
      // The sink strikes synchronously, graces and repeated attacks included.
      const before = strikes.length;
      samplerSink.noteOn(event);
      struck.push(strikes.slice(before));
    },
    mix(event) {
      samplerSink.mix?.(event);
    },
    allNotesOff(when) {
      samplerSink.allNotesOff(when);
    },
    dispose() {
      samplerSink.dispose?.();
    },
  };
  const engine = createTransport({
    context,
    sink,
    metronome: new ClickSynth(context, sampler.master.input),
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
  });
  engine.load(score);
  if (options.metronome) engine.setMetronome(true, 1);
  engine.play();
  const buffer = await drive(context, {
    tickers: [scheduler, frames],
    actions: (options.actions ?? []).map(({ at, run }) => ({
      at,
      run: () => {
        run(engine);
      },
    })),
  });
  engine.dispose();
  return {
    ...signalOf(buffer),
    buffer,
    sampler,
    missed,
    scheduled,
    strikes,
    struck,
    source,
    songSeconds: song,
  };
}
