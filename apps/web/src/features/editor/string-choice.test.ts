import type { Track } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { chooseString, handPosition, neckPositions, neckRange } from './string-choice';

const guitar: Pick<Track, 'tuning' | 'fretCount' | 'capo' | 'drone'> = {
  tuning: [40, 45, 50, 55, 59, 64],
  fretCount: 24,
  capo: 0,
};
const free = new Set<number>();

describe('neckPositions', () => {
  it('lists every string that plays a pitch, string 1 first', () => {
    expect(neckPositions(guitar, 64)).toEqual([
      { string: 1, fret: 0 },
      { string: 2, fret: 5 },
      { string: 3, fret: 9 },
      { string: 4, fret: 14 },
      { string: 5, fret: 19 },
      { string: 6, fret: 24 },
    ]);
  });

  it('counts frets from the capo and drops strings the capo is above', () => {
    expect(neckPositions({ ...guitar, capo: 2 }, 64)).toEqual([
      { string: 2, fret: 3 },
      { string: 3, fret: 7 },
      { string: 4, fret: 12 },
      { string: 5, fret: 17 },
      { string: 6, fret: 22 },
    ]);
  });

  it('is empty below the lowest string and above the neck', () => {
    expect(neckPositions(guitar, 39)).toEqual([]);
    expect(neckPositions(guitar, 89)).toEqual([]);
    expect(neckRange(guitar)).toEqual({ lowest: 40, highest: 88 });
    expect(neckRange({ ...guitar, tuning: [] })).toBeUndefined();
  });

  it('knows only the notated strings of a doubled course', () => {
    const twelve = score().track('twelveString').build().tracks[0];
    if (!twelve) throw new Error('no track');
    expect(twelve.courses).toBeDefined();
    // E4 is on every notated string, the same as on a 6-string: the octave pairs add none.
    expect(neckPositions(twelve, 64)).toHaveLength(6);
  });

  it("starts the banjo's drone string at its own nut: 68 is its stored fret 1, written 6", () => {
    const banjo = score().track('banjo').build().tracks[0];
    if (!banjo) throw new Error('no track');
    expect(neckPositions(banjo, 66).some(({ string }) => string === 5)).toBe(false);
    expect(neckPositions(banjo, 67).find(({ string }) => string === 5)).toEqual({
      string: 5,
      fret: 0,
    });
    expect(neckPositions(banjo, 68).find(({ string }) => string === 5)).toEqual({
      string: 5,
      fret: 1,
    });
  });
});

describe('handPosition', () => {
  it('is the fret on the cursor string, else the lowest fret above the nut, else the nut', () => {
    const notes = [
      { string: 2, fret: 7 },
      { string: 3, fret: 5 },
    ];
    expect(handPosition(guitar, notes, 3)).toBe(5);
    expect(handPosition(guitar, notes, 1)).toBe(5);
    expect(handPosition(guitar, [{ string: 1, fret: 0 }], 4)).toBe(0);
    expect(handPosition(guitar, undefined, 4)).toBe(0);
  });

  it('reads the drone string as the neck prints it', () => {
    const banjo = score().track('banjo').build().tracks[0];
    if (!banjo) throw new Error('no track');
    expect(handPosition(banjo, [{ string: 5, fret: 2 }], 5)).toBe(7);
  });
});

describe('chooseString', () => {
  it('takes the lowest fret from the nut', () => {
    expect(chooseString(guitar, 64, { taken: free, hand: 0, preferred: 3 })).toEqual({
      string: 1,
      fret: 0,
    });
  });

  it('stays in position at fret 7, a tie going to the cursor string and then the higher string', () => {
    expect(chooseString(guitar, 64, { taken: free, hand: 7, preferred: 1 })).toEqual({
      string: 2,
      fret: 5,
    });
    expect(chooseString(guitar, 64, { taken: free, hand: 7, preferred: 3 })).toEqual({
      string: 3,
      fret: 9,
    });
  });

  it('skips strings that hold another note, and is undefined when none is left', () => {
    expect(chooseString(guitar, 64, { taken: new Set([1, 2]), hand: 0, preferred: 1 })).toEqual({
      string: 3,
      fret: 9,
    });
    expect(
      chooseString(guitar, 40, { taken: new Set([6]), hand: 0, preferred: 1 }),
    ).toBeUndefined();
  });

  it('measures the banjo drone from the neck nut', () => {
    const banjo = score().track('banjo').build().tracks[0];
    if (!banjo) throw new Error('no track');
    // 68 is string 5 (written 6) or string 1 fret 6: with the hand at 6, the cursor's string decides.
    expect(chooseString(banjo, 68, { taken: free, hand: 6, preferred: 5 })).toEqual({
      string: 5,
      fret: 1,
    });
    expect(chooseString(banjo, 68, { taken: free, hand: 6, preferred: 1 })).toEqual({
      string: 1,
      fret: 6,
    });
  });
});
