import { describe, expect, it } from 'vitest';

import { pluck, sine, whiteNoise } from '../test-signals';
import { windowFor } from '../strings';
import { detectPitch, rms } from './mpm';

const NOTES: [string, number][] = [
  ['B0', 30.87],
  ['E1', 41.2],
  ['B1', 61.74],
  ['D2', 73.42],
  ['E2', 82.41],
  ['A2', 110],
  ['G3', 196],
  ['E4', 329.63],
  ['E5', 659.26],
  ['B5', 987.77],
  ['E6', 1318.5],
];
const DETUNES = [-37, -12, -3, 0.5, 7, 23, 49];
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('detectPitch', () => {
  it.each([44100, 48000])('reads a pure sine to under 0.1 cent at %i Hz', (sampleRate) => {
    for (const [name, base] of NOTES) {
      // The window follows the lowest string being tuned, here the note itself.
      const size = windowFor(sampleRate, base);
      for (const detune of DETUNES) {
        const hz = base * 2 ** (detune / 1200);
        const found = detectPitch(sine(hz, sampleRate, size), sampleRate, {
          minHz: base * 0.84,
          maxHz: 1500,
        });
        expect(found, `${name} ${String(detune)}`).toBeDefined();
        expect(Math.abs(cents(found?.hz ?? 0, hz)), `${name} ${String(detune)}`).toBeLessThan(0.1);
        expect(found?.clarity).toBeGreaterThan(0.99);
      }
    }
  });

  it('finds nothing in silence and little in white noise', () => {
    const size = 2048;
    expect(detectPitch(new Float32Array(size), 48000, { minHz: 70, maxHz: 1500 })).toBeUndefined();
    for (const seed of [1, 2, 3, 4]) {
      const found = detectPitch(whiteNoise(size, seed), 48000, { minHz: 70, maxHz: 1500 });
      expect(found === undefined || found.clarity < 0.9).toBe(true);
    }
  });

  it('keeps the octave when the fundamental is much weaker than the second harmonic', () => {
    for (const [hz, base] of [
      [41.2, 41.2],
      [82.41, 82.41],
      [110, 82.41],
    ] as const) {
      const size = windowFor(48000, base);
      const tone = pluck({ hz, sampleRate: 48000, seconds: 0.5, weakFundamental: true, seed: 3 });
      const frame = tone.slice(4800, 4800 + size);
      const found = detectPitch(frame, 48000, { minHz: base * 0.84, maxHz: 1500 });
      expect(Math.abs(cents(found?.hz ?? 1, hz))).toBeLessThan(5);
    }
  });

  it('measures the level of a frame', () => {
    expect(rms(new Float32Array(8))).toBe(0);
    expect(rms(sine(100, 48000, 4800, 1))).toBeCloseTo(Math.SQRT1_2, 3);
  });
});
