import { PPQ } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import {
  QUARTER,
  longer,
  overfullMessage,
  restsFor,
  rhythmLabel,
  rhythmTicks,
  shorter,
  toggleDot,
  toggleDoubleDot,
  toggleTriplet,
  ticksLabel,
  type Rhythm,
} from './rhythm';

const eighth: Rhythm = { duration: 8, dots: 0, tuplet: undefined };

describe('rhythm steps', () => {
  it('halves and doubles the denominator and stops at a whole note and a 64th', () => {
    expect(longer(QUARTER)?.duration).toBe(2);
    expect(shorter(QUARTER)?.duration).toBe(8);
    expect(longer({ ...QUARTER, duration: 1 })).toBeUndefined();
    expect(shorter({ ...QUARTER, duration: 64 })).toBeUndefined();
    expect(shorter({ ...eighth, dots: 1 })).toMatchObject({ duration: 16, dots: 1 });
  });

  it('toggles dots: one on and off, two on and off, two to none on the single dot key', () => {
    expect(toggleDot(QUARTER).dots).toBe(1);
    expect(toggleDot({ ...QUARTER, dots: 1 }).dots).toBe(0);
    expect(toggleDot({ ...QUARTER, dots: 2 }).dots).toBe(0);
    expect(toggleDoubleDot(QUARTER).dots).toBe(2);
    expect(toggleDoubleDot({ ...QUARTER, dots: 2 }).dots).toBe(0);
    expect(toggleDoubleDot({ ...QUARTER, dots: 1 }).dots).toBe(2);
  });

  it('toggles a triplet, and any tuplet goes off', () => {
    const triplet = toggleTriplet(eighth);
    expect(triplet.tuplet).toEqual({ n: 3, of: 2 });
    expect(toggleTriplet(triplet).tuplet).toBeUndefined();
    expect(toggleTriplet({ ...eighth, tuplet: { n: 5, of: 4 } }).tuplet).toBeUndefined();
  });
});

describe('labels', () => {
  it('names a rhythm', () => {
    expect(rhythmLabel(QUARTER)).toBe('Quarter');
    expect(rhythmLabel({ ...eighth, dots: 1 })).toBe('Dotted eighth');
    expect(rhythmLabel({ ...eighth, dots: 2 })).toBe('Double-dotted eighth');
    expect(rhythmLabel({ ...eighth, tuplet: { n: 3, of: 2 } })).toBe('Eighth triplet');
    expect(rhythmLabel({ ...eighth, tuplet: { n: 5, of: 4 } })).toBe('Eighth 5:4');
  });

  it('phrases a length of ticks, and the room left for a refusal', () => {
    expect(ticksLabel(PPQ / 2)).toBe('an eighth');
    expect(ticksLabel(PPQ * 1.5)).toBe('a dotted quarter');
    expect(ticksLabel(PPQ / 3)).toBe('0.33 of a quarter');
    expect(overfullMessage(3, PPQ / 2, PPQ)).toBe(
      'Bar 3 has an eighth left: a quarter does not fit',
    );
    expect(overfullMessage(3, 0, PPQ)).toBe('Bar 3 is full: a quarter does not fit');
  });
});

describe('restsFor', () => {
  it('splits a length into the fewest plain and dotted rests, longest first', () => {
    expect(restsFor(0)).toEqual([]);
    expect(restsFor(PPQ)).toEqual([{ duration: 4, dots: 0, tuplet: undefined }]);
    expect(restsFor(PPQ * 1.5)).toEqual([{ duration: 4, dots: 1, tuplet: undefined }]);
    expect(restsFor(PPQ * 2.5)?.map(rhythmTicks)).toEqual([PPQ * 2, PPQ / 2]);
    expect(restsFor(PPQ * 4)).toEqual([{ duration: 1, dots: 0, tuplet: undefined }]);
  });

  it('refuses a length no rest can write', () => {
    expect(restsFor(10)).toBeUndefined();
  });
});
