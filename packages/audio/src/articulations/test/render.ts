import type { Score } from '@reprise/model';

import { createTransport } from '../../transport';
import type { Transport } from '../../transport';
import { drive, manualTicker } from '../../offline-driver';
import { RegionMap } from '../../sampler/region-map';
import type { Envelope } from '../../sampler/region-map';
import { SynthSampleSource } from '../../sampler/sample-source';
import { Sampler } from '../../sampler/sampler';
import type { Instrument } from '../../sampler/sampler';
import { createSamplerSink } from '../../sampler/sampler-sink';
import type { SamplerSinkOptions } from '../../sampler/sampler-sink';
import { SAMPLE_RATE, offline, region, sineInstrument } from '../../sampler/test/offline';
import { detectOnsets } from '../../test/signal';

/** Playback starts this long after `play`; at the default 120 BPM, quarter `k` is at `T0 + k / 2`. */
export const T0 = 0.1;

export interface Render {
  data: Float32Array;
  sampler: Sampler;
}

/**
 * Plays `song` through the engine and the real sampler, one instrument per track, and records the
 * strips' sum before the master bus: no limiter makeup gain and no pre-delay to subtract.
 */
export async function render(
  song: Score,
  options: {
    instrument?: () => Instrument;
    seconds?: number;
    sink?: SamplerSinkOptions;
    fromTick?: number;
    /** Transport calls at context times, e.g. a pause and a resume. */
    actions?: (engine: Transport) => { at: number; run: () => void }[];
  } = {},
): Promise<Render> {
  const context = offline(options.seconds ?? 2.5);
  const sampler = new Sampler(context);
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  for (const track of song.tracks) {
    sampler.addTrack(track, options.instrument?.() ?? sineInstrument());
  }
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createTransport({
    context,
    sink: createSamplerSink(sampler, options.sink),
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: T0,
  });
  engine.load(song);
  engine.play(options.fromTick);
  const actions = options.actions?.(engine) ?? [];
  const buffer = await drive(context, { tickers: [scheduler, frames], actions });
  return { data: buffer.getChannelData(0), sampler };
}

/** The A4 sine, plucked: struck and gone within 30 ms, so every attack stands alone. */
export function pluckedInstrument(decay = 0.03): Instrument {
  const envelope: Envelope = { attack: 0.001, hold: 0, decay, sustain: 0, release: 0.01 };
  return sineInstrument(envelope);
}

/** Seeded white noise across the keyboard: energy at every frequency, for filter tests. */
export function noiseInstrument(): Instrument {
  return {
    regions: new RegionMap([region({ sample: 'noise' })]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      noise: { kind: 'noise', duration: 6, seed: 3, amplitude: 0.5 },
    }),
  };
}

/** Seconds at which the signal rises above `floor` after at least `gap` seconds below it. */
export function onsets(data: Float32Array, gap = 0.01, floor = 1e-3): number[] {
  return detectOnsets({ data, sampleRate: SAMPLE_RATE }, { gap, floor });
}

/**
 * Pitch over time from the period between successive rising zero crossings: `[time, cents]`
 * relative to `reference`.
 */
export function pitchTrack(
  data: Float32Array,
  reference: number,
  from: number,
  to: number,
): [number, number][] {
  const points: [number, number][] = [];
  let previous: number | undefined;
  for (let i = Math.round(from * SAMPLE_RATE) + 1; i < Math.round(to * SAMPLE_RATE); i += 1) {
    const before = data[i - 1] ?? 0;
    const after = data[i] ?? 0;
    if (before < 0 && after >= 0) {
      const at = (i - 1 + before / (before - after)) / SAMPLE_RATE;
      if (previous !== undefined) {
        points.push([(at + previous) / 2, 1200 * Math.log2(1 / (at - previous) / reference)]);
      }
      previous = at;
    }
  }
  return points;
}
