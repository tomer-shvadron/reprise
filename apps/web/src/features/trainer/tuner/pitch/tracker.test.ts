import { describe, expect, it } from 'vitest';

import { midiFromHz } from '../notes';
import { lowpassChain, pluck, sine, simulate, type SimulatedFrame } from '../test-signals';
import { createTracker, settleFramesFor, TRACKER } from './tracker';

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

function sweep(options: { snrDb: number; inharmonicity?: number; weak?: boolean }) {
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

describe('the tuning pipeline on synthetic strings', () => {
  it('reads a harmonic pluck at 30 dB SNR within 2 cents', { timeout: 120_000 }, () => {
    const { worst, slowest } = sweep({ snrDb: 30 });
    console.info(
      `harmonic 30 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
    );
  });

  it('reads a harmonic pluck at 20 dB SNR within 5 cents', { timeout: 120_000 }, () => {
    const { worst, slowest } = sweep({ snrDb: 20 });
    console.info(
      `harmonic 20 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
    );
  });

  it(
    'reads an inharmonic string with a weak fundamental within 3 cents',
    { timeout: 120_000 },
    () => {
      const { worst, slowest } = sweep({ snrDb: 30, inharmonicity: 3e-4, weak: true });
      console.info(
        `inharmonic 30 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
      );
    },
  );
});

describe('the tracker', () => {
  const rate = 48000;
  const run = (signal: Float32Array, lowestHz = 82.41) => simulate(signal, rate, { lowestHz });
  const tone = (hz: number, seconds: number, level = 0.3) =>
    sine(hz, rate, Math.round(seconds * rate), level);
  const concat = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('holds the last reading for 1.5 s, then clears it', () => {
    const frames = run(concat(tone(110, 0.6), new Float32Array(rate * 2)));
    const lastLive = frames.map((f) => Boolean(f.reading && !f.reading.held)).lastIndexOf(true);
    const heldFrames = frames.slice(lastLive + 1).filter((f) => f.reading?.held);
    expect(heldFrames.length).toBeGreaterThan(60);
    const heldMs = (heldFrames.at(-1)?.timeMs ?? 0) - (frames[lastLive]?.timeMs ?? 0);
    expect(heldMs).toBeGreaterThan(1300);
    expect(heldMs).toBeLessThanOrEqual(1500);
    expect(frames.at(-1)?.reading).toBeUndefined();
    expect(frames.at(-1)?.cutoffHz).toBe(TRACKER.searchCutoffHz);
  });

  it('is in tune from 3 cents and stays so until 5', () => {
    const tracker = createTracker();
    const push = (cents: number, n: number, rms = 0.1) => {
      // Reported frames only: the lock is hidden for a few frames while the cutoff closes in.
      let out;
      for (let i = 0; i < n; i += 1) {
        out = tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 0.99 }, rms, 0);
      }
      return out?.reading;
    };
    // The lock is hidden for the settle frames, then each reading within 3 cents counts.
    expect(push(2, settleFramesFor(43))?.inTune).toBe(false);
    expect(push(2, 3)?.inTune).toBe(false);
    expect(push(2, 1)?.inTune).toBe(true);
    expect(push(4.5, 1)?.inTune).toBe(true);
    // The median of five frames lags, so a clear step takes a few frames to show.
    expect(push(8, 5)?.inTune).toBe(false);
    expect(push(2, 5)?.inTune).toBe(false);
    expect(push(2, 5)?.inTune).toBe(true);
  });

  it('moves the lock to a new note within four hops', () => {
    const frames = run(concat(tone(82.41, 0.8), tone(110, 0.8)));
    const boundary = 0.8 * 1000 + 20;
    const after = frames.filter((f) => f.timeMs > boundary && f.reading && !f.reading.held);
    const moved = after.findIndex((f) => Math.abs((f.reading?.hz ?? 0) - 110) < 1);
    expect(moved).toBeGreaterThanOrEqual(0);
    // The window still holds the old note for a while, so count from where the new tone fills it.
    const settled = frames.filter((f) => f.timeMs > boundary + 42.7);
    const first = settled.findIndex((f) => Math.abs((f.reading?.hz ?? 0) - 110) < 1);
    expect(first).toBeLessThanOrEqual(4);
  });

  it('ignores a single frame an octave off', () => {
    const tracker = createTracker();
    const at = (hz: number) => tracker.push({ hz, clarity: 0.95 }, 0.1, 0).reading;
    for (let i = 0; i < settleFramesFor(43) + 3; i += 1) at(110);
    expect(at(220)?.hz).toBeCloseTo(110, 3);
    expect(at(110)?.hz).toBeCloseTo(110, 3);
    at(220);
    at(220);
    expect(at(220)?.hz).toBeCloseTo(220, 3);
  });

  it('lowers the cutoff to 2.5 times the locked note and opens it again after silence', () => {
    const frames = run(concat(tone(110, 0.6), new Float32Array(rate)));
    expect(frames.some((f) => Math.abs(f.cutoffHz - 275) < 2)).toBe(true);
    expect(frames.at(-1)?.cutoffHz).toBe(1500);
  });

  it('gates a decaying tail 30 dB below the peak', () => {
    const decaying = tone(110, 3, 0.3).map((v, i) => v * Math.exp(-i / rate / 0.25));
    const frames = run(decaying);
    const live = frames.filter((f) => f.reading && !f.reading.held);
    expect(live.length).toBeGreaterThan(5);
    expect(live.length).toBeLessThan(frames.length - 20);
  });

  it('passes a tone below the cutoff at its full level through the two sections', () => {
    const out = lowpassChain(tone(110, 0.5), rate, 1500);
    let peak = 0;
    for (let i = out.length - 2000; i < out.length; i += 1) {
      peak = Math.max(peak, Math.abs(out[i] ?? 0));
    }
    expect(peak).toBeGreaterThan(0.3 * 0.99);
    expect(peak).toBeLessThan(0.3 * 1.01);
  });

  it('drops the frames taken through the old cutoff when a string is plucked again in the hold', () => {
    const tracker = createTracker();
    const at = (cents: number, rms = 0.1, timeMs = 0) =>
      tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 0.99 }, rms, timeMs);
    const settle = settleFramesFor(43);
    for (let i = 0; i < settle + 8; i += 1) at(0);
    // The string dies away: the cutoff opens, the last reading is held.
    let step;
    for (let i = 0; i < TRACKER.openAfterRejects + 2; i += 1) {
      step = tracker.push(undefined, 0, 100 + i * 20);
    }
    expect(step?.cutoffHz).toBe(TRACKER.searchCutoffHz);
    expect(step?.reading?.held).toBe(true);
    // Plucked again: the frames through the open cutoff read 16 cents sharp, then the new
    // cutoff has its effect. None of the sharp ones may reach a live reading.
    const live: number[] = [];
    for (let i = 0; i < settle + 6; i += 1) {
      const result = at(i < settle - 2 ? 16 : 0, 0.1, 300 + i * 20);
      if (result.reading && !result.reading.held) live.push((result.reading.midi - 45) * 100);
    }
    expect(live.length).toBeGreaterThan(3);
    for (const cents of live) expect(Math.abs(cents)).toBeLessThan(3);
    expect(Math.abs(at(0, 0.1, 900).cutoffHz - 275)).toBeLessThan(1);
  });

  it('keeps every reading within 3 cents when a string is plucked again inside the hold', () => {
    const hz = 82.41 * 2 ** (7 / 1200);
    const decayed = pluck({
      hz,
      sampleRate: rate,
      seconds: 0.9,
      inharmonicity: 3e-4,
      weakFundamental: true,
      snrDb: 30,
      seed: 4,
    }).map((v, i) => v * Math.exp(-i / rate / 0.12));
    // Pluck, let it die away well under the tail gate, and pluck again within the 1.5 s hold.
    const frames = run(concat(decayed, new Float32Array(Math.round(0.5 * rate)), decayed));
    const target = midiFromHz(hz);
    const secondOnsetMs = 1400;
    const again = frames.filter((f) => f.timeMs > secondOnsetMs && f.reading && !f.reading.held);
    expect(again.length).toBeGreaterThan(3);
    for (const { reading } of again) {
      expect(Math.abs(((reading?.midi ?? 0) - target) * 100)).toBeLessThan(3);
    }
    // The silence opened the cutoff, so the second pluck had to close it again.
    expect(frames.some((f) => f.timeMs > 1000 && f.timeMs < 1400 && f.cutoffHz === 1500)).toBe(
      true,
    );
  });
});
