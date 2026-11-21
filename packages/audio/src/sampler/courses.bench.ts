import { test } from 'vitest';

import { recordMeasurement } from '../test/budget';
import { Sampler } from './sampler';
import type { SamplerTrack } from './sampler';
import { sineInstrument } from './test/offline';

/**
 * What doubling a course costs: 8 tracks of six-string strums, a let-ring chord every 0.5 s,
 * rendered offline for 5 s at 44.1 kHz, once with single strings and once as 12-strings (an
 * octave partner on strings 6 to 3, a unison one on 2 and 1). Both rows are only reported: the
 * second has twice the voices, 96 sounding at the peak against the pool's 64, so it also times
 * the stealing a full strum causes.
 */
const SECONDS = 5;
const TRACKS = 8;
const SAMPLE_RATE = 44_100;
const RUN = { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 };
const BENCH = { timeout: 300_000 };
const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };
const TUNING = [40, 45, 50, 55, 59, 64];
const COURSES = [12, 12, 12, 12, 0, 0];

function track(id: string, doubled: boolean): SamplerTrack {
  return {
    id,
    kind: 'fretted',
    tuning: TUNING,
    capo: 0,
    channel: { ...CHANNEL, mute: false, solo: false },
    ...(doubled && { courses: COURSES }),
  };
}

async function renderSong(doubled: boolean): Promise<void> {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: SECONDS * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });
  const sampler = new Sampler(context);
  for (let i = 0; i < TRACKS; i += 1) {
    const id = `t${String(i)}`;
    sampler.addTrack(track(id, doubled), sineInstrument(undefined, SECONDS));
    for (let beat = 0; beat < 9; beat += 1) {
      for (const [index, key] of TUNING.entries()) {
        const when = beat * 0.5 + index * 0.01;
        sampler.noteOn(id, {
          key: key + (i % 3),
          velocity: 90,
          when,
          string: TUNING.length - index,
          letRing: { until: when + 0.6 },
          ...(doubled && { course: COURSES[index] ?? 0 }),
        });
      }
    }
  }
  await context.startRendering();
}

for (const [label, doubled] of [
  ['single strings', false],
  ['doubled courses', true],
] as const) {
  const metric = `Sampler: 8 strummed tracks, ${label}, 5 s rendered offline`;
  test(metric, BENCH, async (context) => {
    const result = await context
      .bench(metric, async () => {
        await renderSong(doubled);
      })
      .run(RUN);
    await recordMeasurement(context, metric, result.latency.p50);
  });
}
