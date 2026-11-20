import { expect } from 'vitest';

import { midiFromHz } from '../notes';
import { pluck, simulate, type SimulatedFrame } from '../test-signals';

// The sweep behind the tuning-pipeline cases, which tracker-pipeline-*.test.ts run one per file.

const NOTES: [string, number][] = [
  ['B0', 30.87],
  ['E1', 41.2],
  ['E2', 82.41],
  ['A2', 110],
  ['E4', 329.63],
  ['E5', 659.26],
];
const DETUNES = [-23, -3, 0.5, 7, 41];
const SEEDS = [1, 2, 3];
const RATES = [44100, 48000];

/** The worst error in cents over the readings that follow the first lock, and where it began. */
function accuracy(frames: SimulatedFrame[], hz: number) {
  const target = midiFromHz(hz);
  const live = frames.filter((f) => f.reading && !f.reading.held);
  let worst = 0;
  for (const { reading } of live) {
    if (reading) worst = Math.max(worst, Math.abs(reading.midi - target) * 100);
  }
  const first = frames.findIndex((f) => f.reading);
  return { worst, first, count: live.length };
}

export function sweep(options: { snrDb: number; inharmonicity?: number; weak?: boolean }) {
  let worst = 0;
  let slowest = 0;
  for (const sampleRate of RATES) {
    for (const [name, base] of NOTES) {
      for (const detune of DETUNES) {
        for (const seed of SEEDS) {
          const hz = base * 2 ** (detune / 1200);
          const signal = pluck({
            hz,
            sampleRate,
            seconds: 1.5,
            snrDb: options.snrDb,
            inharmonicity: options.inharmonicity ?? 0,
            weakFundamental: options.weak ?? false,
            seed,
          });
          const frames = simulate(signal, sampleRate, { lowestHz: base });
          const { worst: error, first, count } = accuracy(frames, hz);
          const label = `${name} ${String(detune)} seed ${String(seed)} at ${String(sampleRate)}`;
          expect(count, label).toBeGreaterThan(10);
          // The lock stays hidden while the cutoff closes in, see `settleFramesFor`.
          expect(first, label).toBeLessThanOrEqual(16);
          slowest = Math.max(slowest, first);
          if (error > worst) worst = error;
          expect(error, label).toBeLessThan(
            options.snrDb >= 30 && !options.inharmonicity ? 2 : options.inharmonicity ? 3 : 5,
          );
        }
      }
    }
  }
  return { worst, slowest };
}
