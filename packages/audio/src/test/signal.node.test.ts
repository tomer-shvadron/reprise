import { describe, expect, it } from 'vitest';

import {
  bandEnergy,
  cents,
  detectOnsets,
  peak,
  pitchAt,
  rms,
  toneLevel,
  zeroCrossingFrequency,
} from './signal';
import type { Signal } from './signal';

const RATE = 44_100;

function synth(seconds: number, sample: (time: number) => number): Signal {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < data.length; i += 1) data[i] = sample(i / RATE);
  return { data, sampleRate: RATE };
}

const sine =
  (frequency: number, amplitude = 1) =>
  (time: number) =>
    amplitude * Math.sin(2 * Math.PI * frequency * time);

/** A weak fundamental under louder harmonics, as a low guitar string has. */
const HARMONICS = [0.2, 1, 0.6, 0.4, 0.2];
const harmonic = (frequency: number) => (time: number) => {
  let sum = 0;
  for (const [index, level] of HARMONICS.entries()) {
    sum += level * Math.sin(2 * Math.PI * (index + 1) * frequency * time);
  }
  return 0.3 * sum;
};

/** A deterministic white noise, uniform in -1..1. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return (state / 2 ** 32) * 2 - 1;
  };
}

/** Plucks of a sine at `times`, each decaying with time constant `decay`; they overlap. */
function plucks(times: readonly number[], frequency: number, decay: number): (t: number) => number {
  return (time) => {
    let sum = 0;
    for (const start of times) {
      if (time >= start) sum += 0.5 * Math.exp(-(time - start) / decay) * sine(frequency)(time);
    }
    return sum;
  };
}

describe('level', () => {
  it('reads a sine of amplitude a as rms a/√2 and peak a', () => {
    const signal = synth(0.5, sine(440, 0.5));
    expect(rms(signal, 0, 0.5)).toBeCloseTo(0.5 / Math.SQRT2, 4);
    expect(peak(signal, 0, 0.5)).toBeCloseTo(0.5, 3);
    expect(toneLevel(signal, 440, 0, 0.5)).toBeCloseTo(0.5, 3);
  });

  it('clamps spans to the signal', () => {
    const signal = synth(0.1, sine(440));
    expect(rms(signal, -1, 10)).toBeCloseTo(rms(signal, 0, 0.1), 9);
    expect(rms(signal, 5, 6)).toBe(0);
  });
});

describe('detectOnsets', () => {
  const GRID = [0.1, 0.35, 0.6, 0.85];

  it('finds sounds after silence on the sample', () => {
    const signal = synth(1.2, (time) =>
      GRID.some((start) => time >= start && time < start + 0.1) ? sine(440)(time + 0.25 / 440) : 0,
    );
    const found = detectOnsets(signal);
    expect(found).toHaveLength(GRID.length);
    for (const [index, at] of found.entries()) expect(at).toBeCloseTo(GRID[index] ?? 0, 4);
  });

  it('ignores a re-attack over a sounding note unless asked', () => {
    const signal = synth(1.2, plucks(GRID, 220, 0.4));
    expect(detectOnsets(signal)).toHaveLength(1);
    const found = detectOnsets(signal, { rise: 1.5 });
    expect(found).toHaveLength(GRID.length);
    for (const [index, at] of found.entries()) {
      expect(Math.abs(at - (GRID[index] ?? 0))).toBeLessThan(0.002);
    }
  });

  it('reports one onset for a slow attack, not one per hop', () => {
    const signal = synth(0.5, (time) => Math.min(1, time / 0.02) * sine(330)(time));
    expect(detectOnsets(signal, { rise: 2 })).toHaveLength(1);
  });
});

describe('pitchAt', () => {
  it.each([41.2, 82.41, 110, 440, 1318.5])('finds a %f Hz sine within a cent', (frequency) => {
    const signal = synth(0.2, sine(frequency, 0.3));
    const found = pitchAt(signal, 0.02, { window: 0.1 });
    expect(Math.abs(cents(found ?? 0, frequency))).toBeLessThan(1);
  });

  it('finds the fundamental of a harmonic-rich tone, where zero crossings are fooled', () => {
    const signal = synth(0.2, harmonic(110));
    expect(Math.abs(cents(pitchAt(signal, 0.02) ?? 0, 110))).toBeLessThan(1);
    expect(Math.abs(cents(zeroCrossingFrequency(signal, 0.02, 0.12), 110))).toBeGreaterThan(50);
  });

  it('reads the pitch at the time asked, across a change', () => {
    const signal = synth(0.4, (time) => (time < 0.2 ? sine(220)(time) : sine(330)(time)));
    expect(Math.abs(cents(pitchAt(signal, 0.05) ?? 0, 220))).toBeLessThan(1);
    expect(Math.abs(cents(pitchAt(signal, 0.25) ?? 0, 330))).toBeLessThan(1);
  });

  it('is undefined on silence and noise', () => {
    expect(
      pitchAt(
        synth(0.2, () => 0),
        0,
      ),
    ).toBeUndefined();
    const random = noise(7);
    expect(pitchAt(synth(0.2, random), 0)).toBeUndefined();
  });
});

describe('bandEnergy', () => {
  it('reads a sine inside the band as its rms and outside it as nothing', () => {
    const signal = synth(0.25, sine(1000, 0.5));
    expect(bandEnergy(signal, 500, 2000, 0, 0.25)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(bandEnergy(signal, 2500, 10_000, 0, 0.25)).toBeLessThan(1e-3);
  });

  it('splits two tones by band', () => {
    const signal = synth(0.25, (time) => sine(200, 0.4)(time) + sine(5000, 0.1)(time));
    expect(bandEnergy(signal, 20, 1000, 0, 0.25)).toBeCloseTo(0.4 / Math.SQRT2, 2);
    expect(bandEnergy(signal, 2000, 20_000, 0, 0.25)).toBeCloseTo(0.1 / Math.SQRT2, 2);
  });

  it('shares white noise in proportion to bandwidth', () => {
    const signal = synth(1, noise(11));
    const total = bandEnergy(signal, 0, RATE / 2, 0, 1);
    expect(total).toBeCloseTo(rms(signal, 0, 1), 2);
    const lower = bandEnergy(signal, 0, RATE / 4, 0, 1) ** 2;
    const upper = bandEnergy(signal, RATE / 4, RATE / 2, 0, 1) ** 2;
    expect(lower / upper).toBeCloseTo(1, 1);
  });
});
