import { describe, expect, it } from 'vitest';

import { scaleDots, scaleLabel, scaleNotes, MAX_SCALE_DOTS } from './scale-dots';

const STANDARD = [40, 45, 50, 55, 59, 64];
const A = 9;

const frets = (dots: ReturnType<typeof scaleDots>, string: number) =>
  dots.filter((dot) => dot.string === string).map((dot) => dot.absolute);

describe('scaleDots', () => {
  it('marks A minor pentatonic on the high E string and flags the tonic', () => {
    const dots = scaleDots({ strings: 6, frets: 12, capo: 0 }, STANDARD, A, 'minorPentatonic');
    expect(frets(dots, 1)).toEqual([0, 3, 5, 8, 10, 12]);
    expect(dots.filter((dot) => dot.tonic && dot.string === 1).map((dot) => dot.absolute)).toEqual(
      [5, 17].filter((fret) => fret <= 12),
    );
    expect(dots.find((dot) => dot.string === 1 && dot.absolute === 3)).toMatchObject({
      name: 'G',
      degree: '♭7',
    });
  });

  it('counts from the capo: nothing sounds below it', () => {
    const dots = scaleDots({ strings: 6, frets: 12, capo: 2 }, STANDARD, A, 'minorPentatonic');
    expect(Math.min(...frets(dots, 1))).toBe(3);
    // The same tones as without the capo, above fret 2.
    const plain = scaleDots({ strings: 6, frets: 12, capo: 0 }, STANDARD, A, 'minorPentatonic');
    expect(frets(dots, 1)).toEqual(frets(plain, 1).filter((fret) => fret >= 2));
  });

  it("starts a banjo's short string at its own nut and counts its pitch from there", () => {
    const banjo = [67, 50, 55, 59, 62];
    const dots = scaleDots(
      { strings: 5, frets: 17, capo: 0, drone: { string: 5, fret: 5 } },
      banjo,
      7,
      'majorPentatonic',
    );
    // The open short string is G at the fifth fret's place, and it is the tonic.
    expect(dots.find((dot) => dot.string === 5)).toMatchObject({
      absolute: 5,
      name: 'G',
      tonic: true,
    });
    expect(Math.min(...frets(dots, 5))).toBe(5);
    // Two frets on from its own nut is A, the second degree.
    expect(dots.find((dot) => dot.string === 5 && dot.absolute === 7)?.degree).toBe('2');
  });

  it('adds the capo to the banjo drone too', () => {
    const banjo = [67, 50, 55, 59, 62];
    const dots = scaleDots(
      { strings: 5, frets: 17, capo: 2, drone: { string: 5, fret: 5 } },
      banjo,
      9,
      'ionian',
    );
    // G raised by the capo is A, the tonic, at fret 7.
    expect(dots.find((dot) => dot.string === 5)).toMatchObject({ absolute: 7, tonic: true });
  });

  it('covers seven strings and stays under the cap', () => {
    const seven = [35, ...STANDARD];
    const dots = scaleDots({ strings: 7, frets: 24, capo: 0 }, seven, A, 'ionian');
    expect(new Set(dots.map((dot) => dot.string)).size).toBe(7);
    expect(dots.length).toBeLessThanOrEqual(MAX_SCALE_DOTS);
  });
});

describe('scale names', () => {
  it('spells the tones in the key that holds the scale', () => {
    expect(scaleNotes(9, 'minorPentatonic')).toEqual(['A', 'C', 'D', 'E', 'G']);
    expect(scaleNotes(2, 'aeolian')).toEqual(['D', 'E', 'F', 'G', 'A', 'B♭', 'C']);
    expect(scaleLabel(9, 'minorPentatonic')).toBe('A minor pentatonic: A C D E G');
  });
});
