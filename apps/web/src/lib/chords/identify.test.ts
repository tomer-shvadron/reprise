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
    expect(names([46, 50, 53], { fifths: 2, minor: false })[0]).toBe('A#');
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
