import { PPQ } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { durationWidth, segmentWidth, stretch } from './spacing';

describe('durationWidth', () => {
  it('adds the same width for every doubling of the duration', () => {
    const eighth = durationWidth(PPQ / 2, 10);
    const quarter = durationWidth(PPQ, 10);
    const half = durationWidth(PPQ * 2, 10);
    expect(quarter).toBeGreaterThan(eighth);
    expect(half - quarter).toBeCloseTo(quarter - eighth, 9);
    expect(half).toBeLessThan(quarter * 2);
  });

  it('spaces anything shorter than a 64th like a 64th, and scales with the staff space', () => {
    expect(durationWidth(PPQ / 32, 10)).toBe(durationWidth(PPQ / 16, 10));
    expect(durationWidth(PPQ, 20)).toBe(durationWidth(PPQ, 10) * 2);
  });
});

describe('segmentWidth', () => {
  it('splits a beat between the onsets inside it', () => {
    const whole = segmentWidth(PPQ, PPQ, 10);
    expect(segmentWidth(PPQ / 2, PPQ, 10) * 2).toBeCloseTo(whole, 9);
  });
});

describe('stretch', () => {
  it('scales natural widths and never goes below a minimum', () => {
    expect(
      stretch(
        [
          { natural: 10, min: 4 },
          { natural: 20, min: 18 },
        ],
        0.5,
      ),
    ).toEqual([5, 18]);
  });
});
