import { describe, expect, it } from 'vitest';

import { nameChord } from './identify';

const C_MAJOR = { fifths: 0, minor: false };
const names = (pitches: number[], key = C_MAJOR): string[] =>
  nameChord(pitches, key).map((n) => n.name);

describe('nameChord', () => {
  it('names a triad with a third in the bass as a slash chord', () => {
    expect(names([52, 55, 60])[0]).toBe('C/E');
  });

  it('prefers the root in the bass: A C E G over A is Am7, not C6/A', () => {
    const list = names([45, 48, 52, 55]);
    expect(list[0]).toBe('Am7');
    expect(list).toContain('C6/A');
    expect(list.indexOf('Am7')).toBeLessThan(list.indexOf('C6/A'));
  });

  it.each([
    [[40, 47, 52], 'E5'],
    [[47, 50, 53], 'Bdim'],
    [[45, 50, 52], 'Asus4'],
    [[43, 47, 50, 53], 'G7'],
    [[48, 52, 55, 59], 'Cmaj7'],
    [[48, 52, 55, 62], 'Cadd9'],
  ])('names %j as %s', (pitches, expected) => {
    expect(names(pitches)[0]).toBe(expected);
  });

  it('spells for the key', () => {
    expect(names([46, 50, 53], { fifths: -2, minor: false })[0]).toBe('Bb');
    expect(names([46, 50, 53], { fifths: 2, minor: false })[0]).toBe('Bb');
    expect(names([54, 58, 61], { fifths: 3, minor: false })[0]).toBe('F#');
  });

  it('writes borrowed flat chords as flats in a sharp-free key', () => {
    expect(names([46, 50, 53])[0]).toBe('Bb');
    expect(names([51, 55, 58])[0]).toBe('Eb');
    expect(names([56, 60, 63])[0]).toBe('Ab');
    expect(names([49, 52, 56])[0]).toBe('C#m');
    expect(names([54, 58, 61])[0]).toBe('F#');
    expect(names([46, 48, 52, 55])).toContain('C7/Bb');
  });

  it('names C F Bb D as C11 and lets a 6 or an add9 lose its fifth', () => {
    expect(names([48, 53, 58, 62])[0]).toBe('C11');
    expect(names([48, 52, 57])[0]).toBe('C6');
    expect(names([48, 52, 62])[0]).toBe('Cadd9');
    expect(names([48, 53, 55, 58])[0]).toBe('C7sus4');
  });

  it('finds nothing for one pitch class or an unmatched cluster', () => {
    expect(nameChord([60, 72], C_MAJOR)).toEqual([]);
    expect(nameChord([], C_MAJOR)).toEqual([]);
    expect(nameChord([60, 61, 62, 63], C_MAJOR)).toEqual([]);
  });

  it('makes only a power chord from two pitch classes', () => {
    expect(names([40, 47])).toEqual(['E5']);
    expect(names([40, 42])).toEqual([]);
  });
});
