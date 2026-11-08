import { describe, expect, it } from 'vitest';

import { beamY, stemBeamY } from './beams';

describe('stemBeamY', () => {
  const beam = { start: 100, end: 107 };
  const at = (xs: number[]) => xs.map((x) => ({ x, head: 0, beams: 1 }));

  it('agrees with beamY for stems within the beam', () => {
    const stems = at([10, 20, 30]);
    for (const x of [10, 15, 30])
      expect(stemBeamY(stems, beam, x)).toBeCloseTo(beamY(stems, beam, x));
  });

  it('holds a stem outside the first and last to the beam ends', () => {
    const stems = at([10, 10.1, 10.2]);
    expect(stemBeamY(stems, beam, 3)).toBe(100);
    expect(stemBeamY(stems, beam, 40)).toBe(107);
    expect(Math.abs(beamY(stems, beam, 3) - 100)).toBeGreaterThan(100);
  });

  it('is the beam start for stems at one x', () => {
    expect(stemBeamY(at([5, 5]), beam, 9)).toBe(100);
  });
});
