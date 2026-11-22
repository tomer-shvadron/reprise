import { PPQ } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { assert, array, double, property } from 'fast-check';

import { durationWidth, rigidShares, segmentWidth, squeezedMin, stretch } from './spacing';

describe('durationWidth', () => {
  it('adds the same width for every doubling of the duration up to a quarter', () => {
    const sixteenth = durationWidth(PPQ / 4, 10);
    const eighth = durationWidth(PPQ / 2, 10);
    const quarter = durationWidth(PPQ, 10);
    expect(quarter).toBeGreaterThan(eighth);
    expect(quarter - eighth).toBeCloseTo(eighth - sixteenth, 9);
  });

  it('follows a power curve beyond a quarter, continuous at the quarter', () => {
    expect(durationWidth(PPQ, 1)).toBeCloseTo(3.8, 9);
    expect(durationWidth(PPQ * 1.0001, 1)).toBeCloseTo(3.8, 3);
    expect(durationWidth(PPQ * 2, 1)).toBeCloseTo(6.85, 2);
    expect(durationWidth(PPQ * 4, 1)).toBeCloseTo(12.35, 1);
    expect(durationWidth(PPQ * 2, 10)).toBeLessThan(durationWidth(PPQ, 10) * 2);
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

describe('rigidShares', () => {
  it('puts the room after the onset that needs it, with no spring above its onset or below the suffix', () => {
    expect(rigidShares([0, 10, 0, 4])).toEqual([0, 6, 0, 4]);
    expect(rigidShares([8, 2, 3])).toEqual([5, 0, 3]);
    assert(
      property(array(double({ min: 0, max: 100, noNaN: true }), { maxLength: 12 }), (extents) => {
        const shares = rigidShares(extents);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.max(0, ...extents), 9);
        for (const [i, share] of shares.entries()) {
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual((extents[i] ?? 0) + 1e-9);
          // The springs from onset i on hold at least its extent.
          expect(shares.slice(i).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
            (extents[i] ?? 0) - 1e-9,
          );
        }
      }),
    );
  });

  it('keeps a barely squeezed spring close to its minimum, so no gap opens at the bar end', () => {
    // A wide early onset: the last spring's rigid part is its own, not the widest.
    const extents = [30, 0, 0, 6];
    const shares = rigidShares(extents);
    const springs = extents.map((extent, i) => ({
      natural: 40,
      min: 20 + extent,
      rigid: shares[i] ?? 0,
    }));
    for (const spring of springs) {
      expect(squeezedMin(spring, 0.99)).toBeLessThanOrEqual(spring.min);
      expect(squeezedMin(spring, 1)).toBe(spring.min);
    }
    // The last spring grows by its own 6 px share at most, not by the widest extent's 30.
    const last = springs[3] ?? { natural: 0, min: 0 };
    expect(squeezedMin(last, 0.99)).toBeLessThan(last.min * 0.99 + 6 + 1e-9);
  });

  it('scales the movable part before the fixed one when they alone overflow', () => {
    const spring = { natural: 50, min: 40, rigid: 20, movable: 10 };
    expect(squeezedMin(spring, 0, 0.5)).toBe(25);
    expect(squeezedMin(spring, 0, 0)).toBe(20);
    expect(squeezedMin(spring, 0, 0, 0.5)).toBe(10);
  });

  it('scales the fingering clearance on its own, ahead of the movable part', () => {
    const spring = { natural: 50, min: 40, rigid: 20, movable: 10, marks: 6 };
    expect(squeezedMin(spring, 0)).toBe(20 + 10 + 6);
    expect(squeezedMin(spring, 0, 1, 1, 0.5)).toBe(33);
    expect(squeezedMin(spring, 0, 1, 1, 0)).toBe(30);
    expect(squeezedMin(spring, 1, 1, 1, 0)).toBe(40);
  });
});
