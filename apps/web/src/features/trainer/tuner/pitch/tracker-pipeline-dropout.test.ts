import { describe, expect, it } from 'vitest';

import { midiFromHz } from '../notes';
import { windowFor } from '../strings';
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

const DROPS = [2, 5, 20];
// First lock (the splice before, on and after the settle deadline), then a steady note.
const POSITIONS_MS = [
  ...Array.from({ length: 33 }, (_, i) => 160 + 5 * i),
  ...Array.from({ length: 11 }, (_, i) => 450 + 15 * i),
];

/** The worst live reading, in cents off `targetMidi` plus `detune`, over every splice. */
function worstAcross(base: Float32Array, lowestHz: number, targetMidi: number, detune: number) {
  let worst = 0;
  for (const samples of DROPS)
    for (const atMs of POSITIONS_MS) {
      const at = Math.round((atMs / 1000) * RATE);
      const signal = new Float32Array(base.length - samples);
      signal.set(base.subarray(0, at));
      signal.set(base.subarray(at + samples), at);
      for (const { reading } of simulate(signal, RATE, { lowestHz })) {
        if (reading && !reading.held)
          worst = Math.max(worst, Math.abs((reading.midi - targetMidi) * 100 - detune));
      }
    }
  return worst;
}

describe('the tuning pipeline across dropped samples (#433, #474)', () => {
  // Dropping `samples` at `atMs` splices the tone; the frames holding the splice read 4 to 6
  // cents off at clarity 1.0 at the 2048 window and about 10 at the 4096 one, where a splice
  // spans up to five frames; the long median and agreement of #474 cover that.
  it('never shows a reading more than 2 cents off a clean A2 +7 cents', { timeout: 30_000 }, () => {
    const base = harmonicTone(A2_PLUS_7, Math.round(RATE * 1.2));
    expect(windowFor(RATE, 82.41)).toBe(2048);
    expect(worstAcross(base, 82.41, 45, 7)).toBeLessThan(2);
  });

  // lowestHz 30 is the chromatic tuner's floor: a 4096 window.
  it('holds at the 4096 window: A2 +7 cents, chromatic', { timeout: 30_000 }, () => {
    const base = harmonicTone(A2_PLUS_7, Math.round(RATE * 1.2));
    expect(windowFor(RATE, 30)).toBe(4096);
    expect(worstAcross(base, 30, 45, 7)).toBeLessThan(2);
  });

  it('holds at the 4096 window: E1, a bass', { timeout: 30_000 }, () => {
    const base = harmonicTone(41.2, Math.round(RATE * 1.2));
    expect(windowFor(RATE, 41.2)).toBe(4096);
    expect(worstAcross(base, 41.2, midiFromHz(41.2), 0)).toBeLessThan(2);
  });

  it('holds at the 4096 window: B0, a five-string bass', { timeout: 30_000 }, () => {
    const base = harmonicTone(30.87, Math.round(RATE * 1.2));
    expect(windowFor(RATE, 30.87)).toBe(4096);
    expect(worstAcross(base, 30.87, midiFromHz(30.87), 0)).toBeLessThan(2);
  });
});
