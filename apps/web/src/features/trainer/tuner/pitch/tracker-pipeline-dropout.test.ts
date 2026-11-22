import { describe, expect, it } from 'vitest';

import { simulate } from '../test-signals';

const RATE = 48000;
const A2_PLUS_7 = 110 * 2 ** (7 / 1200);

/** The harmonic tone of the tuner's browser test: partials 1 to 15 at 1/n. */
function harmonicTone(hz: number, length: number) {
  const out = new Float32Array(length);
  for (let n = 1; n < 16; n += 1)
    for (let i = 0; i < length; i += 1)
      out[i] = (out[i] ?? 0) + (0.3 / n) * Math.sin((2 * Math.PI * n * hz * i) / RATE);
  return out;
}

describe('the tuning pipeline across dropped samples (#433)', () => {
  // Dropping `samples` at `atMs` splices the tone; the frames holding the splice read 4 to 6
  // cents off at clarity 1.0, which is what the CI run that failed showed. The positions cover
  // the splice landing before, on and after the settle deadline of the first lock.
  it('never shows a reading more than 2 cents off a clean A2 +7 cents', () => {
    const base = harmonicTone(A2_PLUS_7, Math.round(RATE * 1.2));
    const samples = 5;
    let worst = 0;
    for (let atMs = 160; atMs <= 320; atMs += 5) {
      const at = Math.round((atMs / 1000) * RATE);
      const signal = new Float32Array(base.length - samples);
      signal.set(base.subarray(0, at));
      signal.set(base.subarray(at + samples), at);
      for (const { reading } of simulate(signal, RATE, { lowestHz: 82.41 })) {
        if (reading && !reading.held)
          worst = Math.max(worst, Math.abs((reading.midi - 45) * 100 - 7));
      }
    }
    expect(worst).toBeLessThan(2);
  });
});
