import { describe, expect, it } from 'vitest';

import { fitSprings } from './breaking';
import { stretch, type Spring } from './spacing';

const bars: Spring[][] = [
  [
    { natural: 40, min: 10 },
    { natural: 20, min: 18 },
  ],
  [
    { natural: 30, min: 6 },
    { natural: 10, min: 9 },
  ],
];
const natural = 100;
const mins = 43;

const total = (factor: number, squeeze: number): number =>
  bars.reduce((sum, springs) => sum + stretch(springs, factor, squeeze).reduce((a, b) => a + b), 0);

describe('fitSprings', () => {
  it('scales every spring alike while none reaches its minimum', () => {
    expect(fitSprings(bars, natural, 95)).toEqual({ factor: 95 / natural, squeeze: 1 });
  });

  it('holds springs at their minimums and shrinks the others to fill the room exactly', () => {
    const { factor, squeeze } = fitSprings(bars, natural, 60);
    expect(squeeze).toBe(1);
    expect(factor).toBeLessThan(60 / natural);
    expect(total(factor, squeeze)).toBeCloseTo(60, 9);
  });

  it('scales the minimums when even they overflow', () => {
    expect(fitSprings(bars, natural, 30)).toEqual({ factor: 0, squeeze: 30 / mins });
    expect(total(0, 30 / mins)).toBeCloseTo(30, 9);
  });

  it('justifies a short system without clamping', () => {
    const { factor, squeeze } = fitSprings(bars, natural, 130);
    expect(factor).toBeGreaterThan(1);
    expect(squeeze).toBe(1);
    expect(total(factor, squeeze)).toBeCloseTo(130, 9);
  });
});
