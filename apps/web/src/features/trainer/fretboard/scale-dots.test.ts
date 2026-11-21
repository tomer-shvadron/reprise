import { describe, expect, it } from 'vitest';

import { SCALES } from '@/lib/insights';

import {
  alterOf,
  defaultTonicName,
  MAX_SCALE_DOTS,
  scaleDots,
  scaleLabel,
  scaleNotes,
  type ScaleSpec,
} from './scale-dots';

const STANDARD = [40, 45, 50, 55, 59, 64];
const A = 9;
const spec = (tonic: number, scaleId: ScaleSpec['scaleId'], tonicName?: string): ScaleSpec => ({
  tonic,
  tonicName: tonicName ?? defaultTonicName(tonic, scaleId),
  scaleId,
});

const frets = (dots: ReturnType<typeof scaleDots>, string: number) =>
  dots.filter((dot) => dot.string === string).map((dot) => dot.absolute);

describe('scaleDots', () => {
  it('marks A minor pentatonic on the high E string and flags the tonic', () => {
    const dots = scaleDots(
      { strings: 6, frets: 12, capo: 0 },
      STANDARD,
      spec(A, 'minorPentatonic'),
    );
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
    const dots = scaleDots(
      { strings: 6, frets: 12, capo: 2 },
      STANDARD,
      spec(A, 'minorPentatonic'),
    );
    expect(Math.min(...frets(dots, 1))).toBe(3);
    // The same tones as without the capo, above fret 2.
    const plain = scaleDots(
      { strings: 6, frets: 12, capo: 0 },
      STANDARD,
      spec(A, 'minorPentatonic'),
    );
    expect(frets(dots, 1)).toEqual(frets(plain, 1).filter((fret) => fret >= 2));
  });

  it("starts a banjo's short string at its own nut and counts its pitch from there", () => {
    const banjo = [67, 50, 55, 59, 62];
    const dots = scaleDots(
      { strings: 5, frets: 17, capo: 0, drone: { string: 5, fret: 5 } },
      banjo,
      spec(7, 'majorPentatonic'),
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
      spec(9, 'ionian'),
    );
    // G raised by the capo is A, the tonic, at fret 7.
    expect(dots.find((dot) => dot.string === 5)).toMatchObject({ absolute: 7, tonic: true });
  });

  it('covers seven strings and stays under the cap', () => {
    const seven = [35, ...STANDARD];
    const dots = scaleDots({ strings: 7, frets: 24, capo: 0 }, seven, spec(A, 'ionian'));
    expect(new Set(dots.map((dot) => dot.string)).size).toBe(7);
    expect(dots.length).toBeLessThanOrEqual(MAX_SCALE_DOTS);
  });
});

describe('scale names', () => {
  it('spells the tones by degree', () => {
    expect(scaleNotes('A', 'minorPentatonic')).toEqual(['A', 'C', 'D', 'E', 'G']);
    expect(scaleNotes('D', 'aeolian')).toEqual(['D', 'E', 'F', 'G', 'A', 'B♭', 'C']);
    expect(scaleLabel({ tonicName: 'A', scaleId: 'minorPentatonic' })).toBe(
      'A minor pentatonic: A C D E G',
    );
  });

  it('spells the scales that sit in no major key', () => {
    expect(scaleNotes('A', 'blues')).toEqual(['A', 'C', 'D', 'E♭', 'E', 'G']);
    expect(scaleNotes('E', 'blues')).toEqual(['E', 'G', 'A', 'B♭', 'B', 'D']);
    expect(scaleNotes('C', 'majorBlues')).toEqual(['C', 'D', 'E♭', 'E', 'G', 'A']);
    expect(scaleNotes('D', 'harmonicMinor')).toEqual(['D', 'E', 'F', 'G', 'A', 'B♭', 'C♯']);
    expect(scaleNotes('G', 'harmonicMinor')).toEqual(['G', 'A', 'B♭', 'C', 'D', 'E♭', 'F♯']);
    expect(scaleNotes('D', 'melodicMinor')).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C♯']);
    expect(scaleNotes('A', 'phrygianDominant')).toEqual(['A', 'B♭', 'C♯', 'D', 'E', 'F', 'G']);
    expect(scaleNotes('D', 'phrygianDominant')).toEqual(['D', 'E♭', 'F♯', 'G', 'A', 'B♭', 'C']);
  });

  it('keeps the tonic as it was spelled', () => {
    expect(scaleLabel({ tonicName: 'E♭', scaleId: 'blues' })).toBe('E♭ blues: E♭ G♭ A♭ A B♭ D♭');
  });

  const TONICS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  it('gives every seven-note scale seven letters, and every tone its pitch, on every tonic', () => {
    const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    TONICS.forEach((tonicName, tonic) => {
      for (const scale of SCALES) {
        const names = scaleNotes(tonicName, scale.id);
        const label = `${tonicName} ${scale.id}`;
        expect(names, label).toHaveLength(scale.intervals.length);
        if (scale.intervals.length === 7) {
          expect(new Set(names.map((name) => name.charAt(0))).size, label).toBe(7);
        }
        names.forEach((name, at) => {
          const alter = alterOf(name.slice(1));
          const pitch = ((((NATURAL[name.charAt(0)] ?? 0) + alter) % 12) + 12) % 12;
          expect(pitch, `${label} degree ${String(at + 1)}`).toBe(
            (tonic + (scale.intervals[at] ?? 0)) % 12,
          );
        });
      }
    });
  });

  it('is deterministic about the default tonic spelling', () => {
    expect(defaultTonicName(3, 'majorBlues')).toBe('E♭');
    expect(defaultTonicName(2, 'dorian')).toBe('D');
  });
});

describe('the dot cap', () => {
  it('ends a very long neck at a whole fret rather than dropping strings', () => {
    const tuning = [28, 33, 38, 43, 47, 52, 57, 62, 67, 72];
    const dots = scaleDots({ strings: 10, frets: 48, capo: 0 }, tuning, spec(9, 'ionian'));
    expect(dots.length).toBeLessThanOrEqual(MAX_SCALE_DOTS);
    const last = Math.max(...dots.map((dot) => dot.absolute));
    expect(last).toBeLessThan(48);
    // Every fret up to the last holds the same set of strings it would uncapped.
    const full = scaleDots({ strings: 10, frets: last, capo: 0 }, tuning, spec(9, 'ionian'));
    expect(dots).toEqual(full);
    expect(new Set(dots.map((dot) => dot.string)).size).toBe(10);
  });
});
