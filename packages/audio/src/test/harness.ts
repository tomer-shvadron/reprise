/**
 * The offline harness: a score rendered through the real engine, scheduler, articulations and
 * sampler into an `OfflineAudioContext`, with GeneralUser GS behind the GM tier or any
 * instrument a test supplies. What to listen for is in `./signal`.
 */
import type { Id, Score, Track } from '@reprise/model';
import { secondsAtTick } from '@reprise/model';

import { ClickSynth } from '../click-synth';
import { createAudioEngine } from '../engine';
import type { AudioEngine } from '../engine';
import { drive, manualTicker } from '../offline-driver';
import type { RegionMap, SampleRef } from '../sampler/region-map';
import { Sampler } from '../sampler/sampler';
import type { Instrument } from '../sampler/sampler';
import { createSamplerSink } from '../sampler/sampler-sink';
import { GM_BUDGET_BYTES, ManagedSampleSource } from '../samples/managed-sample-source';
import type { InstrumentId } from '../samples/types';
import { PERCUSSION_BANK, Sf2Soundfont } from '../sf2/soundfont';
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

let generalUser: Promise<Sf2Soundfont | undefined> | undefined;

/** GeneralUser GS, parsed once per test file; `undefined` until `pnpm sounds:fetch` has run. */
export function loadGeneralUser(): Promise<Sf2Soundfont | undefined> {
  generalUser ??= (async () => {
    try {
      const response = await fetch(GENERAL_USER);
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A dev server may answer a missing file with its HTML fallback rather than a 404.
      if (String.fromCodePoint(...bytes.subarray(0, 4)) !== 'RIFF') return undefined;
      return Sf2Soundfont.parse(bytes);
    } catch {
      return undefined;
    }
  })();
  return generalUser;
}

/** The bank and program a GM player picks for a track: drum kits live in the percussion bank. */
function presetOf(track: Pick<Track, 'kind' | 'bank'>, program: number): [number, number] {
  return track.kind === 'drums' ? [PERCUSSION_BANK, program] : [track.bank, program];
}

export interface RenderOptions {
  /**
   * Where the notes come from: a soundfont plays each track's GM preset through the memory
   * manager, as the GM tier does; a function supplies the instrument per track.
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
  actions?: readonly { at: number; run: (engine: AudioEngine) => void }[];
}

/** A note the sampler skipped because its sample was not decoded. */
export interface Miss {
  track: Id;
  sample: SampleRef;
}

export interface Rendered extends Signal {
  buffer: AudioBuffer;
  sampler: Sampler;
  missed: Miss[];
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
): Promise<{ source: ManagedSampleSource; instrumentOf: (track: Track) => Instrument }> {
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
  return {
    source,
    instrumentOf: (track) => {
      const regions = maps.get(instrumentOf(track, track.program));
      if (!regions) throw new Error(`no region map for track ${track.name}`);
      return { regions, source };
    },
  };
}

/**
 * Loads `score` into a fresh engine over the real sampler, presses play at time 0 and renders.
 * Deterministic: the scheduler and position timers are fired at every 1024-frame suspension.
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
  if (options.instruments instanceof Sf2Soundfont) {
    ({ source, instrumentOf } = await gmInstruments(score, options.instruments, context));
  } else {
    instrumentOf = options.instruments;
  }
  const missed: Miss[] = [];
  const sampler = new Sampler(context, {
    onMiss: (track, sample) => missed.push({ track, sample }),
  });
  if (options.tap === 'strips') {
    sampler.master.input.disconnect();
    sampler.master.input.connect(context.destination);
  }
  for (const track of score.tracks) sampler.addTrack(track, instrumentOf(track));
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createAudioEngine({
    context,
    sink: createSamplerSink(sampler),
    metronome: new ClickSynth(context, sampler.master.input),
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
  });
  await engine.load(score, { tier: 'gm', packs: [] });
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
  return { ...signalOf(buffer), buffer, sampler, missed, source, songSeconds: song };
}
