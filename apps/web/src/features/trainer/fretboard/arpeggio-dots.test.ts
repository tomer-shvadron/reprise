import { describe, expect, it } from 'vitest';

import { arpeggioDots, arpeggioLabel, arpeggioOf } from './arpeggio-dots';
import { MAX_NECK_TONES } from './neck-tones';

const STANDARD = [40, 45, 50, 55, 59, 64];
const notes = (name: string) => arpeggioOf(name)?.notes;

describe('arpeggioOf', () => {
  it('spells the tones from the chord root', () => {
    expect(notes('Bb7')).toEqual(['B♭', 'D', 'F', 'A♭']);
    expect(notes('F#m7b5')).toEqual(['F♯', 'A', 'C', 'E']);
    expect(notes('Ebdim7')).toEqual(['E♭', 'G♭', 'A', 'C']);
    expect(notes('C/E')).toEqual(['C', 'E', 'G']);
    expect(notes('G/F#')).toEqual(['G', 'B', 'D']);
  });

  it('is undefined for an unknown quality or a non-chord', () => {
    expect(arpeggioOf('C7alt')).toBeUndefined();
    expect(arpeggioOf('N.C.')).toBeUndefined();
  });

  it('names the layer for a screen reader', () => {
    const am7 = arpeggioOf('Am7');
    expect(am7 && arpeggioLabel(am7)).toBe('Am7 chord tones: A R, C ♭3, E 5, G ♭7');
  });
});

describe('arpeggioDots', () => {
  const am = arpeggioOf('Am');
  if (!am) throw new Error('Am');

  it('marks the root and the degrees', () => {
    const dots = arpeggioDots({ strings: 6, frets: 12, capo: 0 }, STANDARD, am);
    const high = dots.filter((dot) => dot.string === 1);
    expect(high.map((dot) => [dot.absolute, dot.degree, dot.root])).toEqual([
      [0, '5', false],
      [5, 'R', true],
      [8, '♭3', false],
      [12, '5', false],
    ]);
    expect(dots.some((dot) => 'outsideScale' in dot)).toBe(false);
  });

  it('counts from the capo and the banjo drone', () => {
    const capo = arpeggioDots({ strings: 6, frets: 12, capo: 2 }, STANDARD, am);
    expect(Math.min(...capo.map((dot) => dot.absolute))).toBeGreaterThanOrEqual(2);
    const banjo = arpeggioDots(
      { strings: 5, frets: 17, capo: 0, drone: { string: 5, fret: 5 } },
      [67, 50, 55, 59, 62],
      am,
    );
    expect(
      Math.min(...banjo.filter((d) => d.string === 5).map((d) => d.absolute)),
    ).toBeGreaterThanOrEqual(5);
  });

  it('works on 7 and 10 strings within the cap', () => {
    const seven = [35, ...STANDARD];
    expect(
      arpeggioDots({ strings: 7, frets: 24, capo: 0 }, seven, am).some((dot) => dot.string === 7),
    ).toBe(true);
    const ten = [28, 33, 38, 43, 47, 52, 57, 62, 67, 72];
    const c13 = arpeggioOf('C13');
    if (!c13) throw new Error('C13');
    // Six tones on 10 strings over 60 frets is about 305 positions: past the cap.
    const dots = arpeggioDots({ strings: 10, frets: 60, capo: 0 }, ten, c13);
    expect(dots.length).toBeLessThanOrEqual(MAX_NECK_TONES);
    expect(dots.length).toBeGreaterThan(MAX_NECK_TONES - 10);
    const last = Math.max(...dots.map((dot) => dot.absolute));
    expect(last).toBeLessThan(60);
    // It stops at a whole fret: the last fret kept has every string that sounds a tone.
    const full = arpeggioDots({ strings: 10, frets: last, capo: 0 }, ten, c13);
    expect(dots).toEqual(full);
  });

  it('flags a tone outside the given scale', () => {
    const e7 = arpeggioOf('E7');
    if (!e7) throw new Error('E7');
    // A natural minor has G, not G#.
    const dots = arpeggioDots({ strings: 6, frets: 12, capo: 0 }, STANDARD, e7, {
      tonic: 9,
      scaleId: 'aeolian',
    });
    const outside = new Set(dots.filter((dot) => dot.outsideScale).map((dot) => dot.name));
    expect(outside).toEqual(new Set(['G♯']));
  });
});
