import { describe, expect, it } from 'vitest';

import { beatName, clickBeats, countsDotted, isCompound, type Meter } from './meter';

const meter = (numerator: number, denominator: Meter['denominator'], dotted = true): Meter => ({
  numerator,
  denominator,
  dotted,
});

describe('meter', () => {
  it('offers dotted counting only for x/8 with x a multiple of 3', () => {
    expect([6, 9, 12].every((n) => isCompound(meter(n, 8)))).toBe(true);
    expect(isCompound(meter(7, 8))).toBe(false);
    expect(isCompound(meter(6, 4))).toBe(false);
  });

  it('maps 6/8 to two dotted-quarter beats, and 6/8 counted in eighths to six', () => {
    expect(clickBeats(meter(6, 8))).toBe(2);
    expect(clickBeats(meter(12, 8))).toBe(4);
    expect(clickBeats(meter(6, 8, false))).toBe(6);
    expect(clickBeats(meter(7, 8))).toBe(7);
    expect(countsDotted(meter(6, 8, false))).toBe(false);
  });

  it('names the beat the BPM counts', () => {
    expect(beatName(meter(4, 4))).toBe('quarter');
    expect(beatName(meter(3, 2))).toBe('half');
    expect(beatName(meter(7, 8))).toBe('eighth');
    expect(beatName(meter(6, 8))).toBe('dotted quarter');
  });
});
