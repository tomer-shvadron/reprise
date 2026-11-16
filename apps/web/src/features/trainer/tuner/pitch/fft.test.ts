import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../test-signals';
import { autocorrelate } from './fft';

function naive(frame: Float64Array): Float64Array {
  const out = new Float64Array(frame.length);
  for (let tau = 0; tau < frame.length; tau += 1) {
    let sum = 0;
    for (let j = 0; j + tau < frame.length; j += 1) sum += (frame[j] ?? 0) * (frame[j + tau] ?? 0);
    out[tau] = sum;
  }
  return out;
}

describe('autocorrelate', () => {
  it.each([2048, 4096])('matches the direct sum on a seeded frame of %i', (size) => {
    const random = mulberry32(size);
    const frame = Float64Array.from({ length: size }, () => random() * 2 - 1);
    const fast = autocorrelate(frame);
    const slow = naive(frame);
    let worst = 0;
    for (let i = 0; i < size; i += 1)
      worst = Math.max(worst, Math.abs((fast[i] ?? 0) - (slow[i] ?? 0)));
    expect(worst).toBeLessThan(1e-9);
  });
});
