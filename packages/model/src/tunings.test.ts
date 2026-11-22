import { describe, expect, it } from 'vitest';

import { STANDARD_TUNING } from './factories';
import { MAX_STRINGS } from './track';
import { STANDARD_TUNINGS, findTuningName } from './tunings';

describe('STANDARD_TUNINGS', () => {
  it.each([
    ['E standard', 'E2 A2 D3 G3 B3 E4', [40, 45, 50, 55, 59, 64]],
    ['Drop D', 'D2 A2 D3 G3 B3 E4', [38, 45, 50, 55, 59, 64]],
    ['Eb standard', 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4', [39, 44, 49, 54, 58, 63]],
    ['D standard', 'D2 G2 C3 F3 A3 D4', [38, 43, 48, 53, 57, 62]],
    ['Drop C', 'C2 G2 C3 F3 A3 D4', [36, 43, 48, 53, 57, 62]],
    ['DADGAD', 'D2 A2 D3 G3 A3 D4', [38, 45, 50, 55, 57, 62]],
    ['Open G', 'D2 G2 D3 G3 B3 D4', [38, 43, 50, 55, 59, 62]],
    ['Open D', 'D2 A2 D3 F#3 A3 D4', [38, 45, 50, 54, 57, 62]],
    ['7-string standard', 'B1 E2 A2 D3 G3 B3 E4', [35, 40, 45, 50, 55, 59, 64]],
    ['7-string drop A', 'A1 E2 A2 D3 G3 B3 E4', [33, 40, 45, 50, 55, 59, 64]],
    ['Bass standard', 'E1 A1 D2 G2', [28, 33, 38, 43]],
    ['5-string bass standard', 'B0 E1 A1 D2 G2', [23, 28, 33, 38, 43]],
    ['Drop D bass', 'D1 A1 D2 G2', [26, 33, 38, 43]],
    ['Ukulele standard', 'G4 C4 E4 A4', [67, 60, 64, 69]],
    ['8-string standard', 'F#1 B1 E2 A2 D3 G3 B3 E4', [30, 35, 40, 45, 50, 55, 59, 64]],
    ['6-string bass standard', 'B0 E1 A1 D2 G2 C3', [23, 28, 33, 38, 43, 48]],
    ['Tenor banjo CGDA', 'C3 G3 D4 A4', [48, 55, 62, 69]],
    ['Irish tenor banjo GDAE', 'G2 D3 A3 E4', [43, 50, 57, 64]],
    ['Ukulele low G', 'G3 C4 E4 A4', [55, 60, 64, 69]],
    ['Baritone ukulele DGBE', 'D3 G3 B3 E4', [50, 55, 59, 64]],
  ])('%s is %s', (name, _notes, strings) => {
    expect(STANDARD_TUNINGS.find((tuning) => tuning.name === name)?.strings).toEqual(strings);
    expect(findTuningName(strings)).toBe(name);
  });

  it.each([
    ['Violin GDAE', 'G3 D4 A4 E5', [55, 62, 69, 76], 40],
    ['Viola CGDA', 'C3 G3 D4 A4', [48, 55, 62, 69], 41],
    ['Cello CGDA', 'C2 G2 D3 A3', [36, 43, 50, 57], 42],
    ['Double bass EADG', 'E1 A1 D2 G2', [28, 33, 38, 43], 43],
    ['Shamisen honchoshi', 'C3 F3 C4', [48, 53, 60], 106],
    ['Shamisen niagari', 'C3 G3 C4', [48, 55, 60], 106],
    ['Shamisen sansagari', 'C3 F3 Bb3', [48, 53, 58], 106],
  ])('%s is %s, and named only on program %i', (name, _notes, strings, program) => {
    expect(STANDARD_TUNINGS.find((tuning) => tuning.name === name)?.strings).toEqual(strings);
    expect(findTuningName(strings, { program })).toBe(name);
    expect(findTuningName(strings)).not.toBe(name);
    expect(findTuningName(strings, { program: 25 })).not.toBe(name);
  });

  it('names every row for some program, or for none', () => {
    for (const { name, strings, courses, drone } of STANDARD_TUNINGS) {
      const programs = [undefined, ...Array.from({ length: 128 }, (_, program) => program)];
      expect(
        programs.some((program) => findTuningName(strings, { courses, drone, program }) === name),
        name,
      ).toBe(true);
    }
  });

  it('has unique names and tunings that fit a track', () => {
    expect(new Set(STANDARD_TUNINGS.map(({ name }) => name)).size).toBe(STANDARD_TUNINGS.length);
    const keys = STANDARD_TUNINGS.map(({ strings, courses, drone, instrument }) =>
      [
        strings.join(','),
        courses?.join(',') ?? '',
        drone ? `${String(drone.string)}@${String(drone.fret)}` : '',
        instrument,
      ].join('|'),
    );
    expect(new Set(keys).size).toBe(STANDARD_TUNINGS.length);
    for (const { strings } of STANDARD_TUNINGS)
      expect(strings.length).toBeLessThanOrEqual(MAX_STRINGS);
  });
});

describe('findTuningName', () => {
  it('names the factory default', () => {
    expect(findTuningName(STANDARD_TUNING)).toBe('E standard');
  });

  it('is undefined for a custom tuning or a different string count', () => {
    expect(findTuningName([40, 45, 50, 55, 59, 63])).toBeUndefined();
    expect(findTuningName([45, 50, 55, 59, 64])).toBeUndefined();
    expect(findTuningName([])).toBeUndefined();
  });
});

describe('courses, drone and findTuningName', () => {
  const entry = (name: string) => STANDARD_TUNINGS.find((tuning) => tuning.name === name);

  it('carries the 12-string courses, the mandolin unisons and the banjo drone', () => {
    expect(entry('12-string standard')?.courses).toEqual([12, 12, 12, 12, 0, 0]);
    expect(entry('Mandolin GDAE')?.courses).toEqual([0, 0, 0, 0]);
    for (const name of ['Banjo Open G', 'Banjo Double C', 'Banjo Open D', 'Banjo G modal']) {
      expect(entry(name)?.drone).toEqual({ string: 5, fret: 5 });
      expect(entry(name)?.instrument).toBe('banjo');
    }
    expect(entry('Tenor banjo CGDA')?.drone).toBeUndefined();
  });

  it('tells the 12-string from E standard and the banjo from the same strings without a drone', () => {
    const e = [40, 45, 50, 55, 59, 64];
    expect(findTuningName(e)).toBe('E standard');
    expect(findTuningName(e, { courses: [12, 12, 12, 12, 0, 0] })).toBe('12-string standard');
    expect(findTuningName(e, { courses: [null, null, null, null, null, null] })).toBe('E standard');
    const openG = [67, 50, 55, 59, 62];
    expect(findTuningName(openG, { drone: { string: 5, fret: 5 } })).toBe('Banjo Open G');
    expect(findTuningName(openG)).toBeUndefined();
  });

  it('keeps every string count within what a track holds', () => {
    expect(entry('8-string standard')?.strings).toHaveLength(8);
    expect(entry('6-string bass standard')?.strings).toHaveLength(6);
  });
});

describe('the program hint of findTuningName', () => {
  const cgda = [48, 55, 62, 69];
  const eadg = [28, 33, 38, 43];

  it('tells a viola from a tenor banjo and a double bass from a bass', () => {
    expect(findTuningName(cgda, { program: 41 })).toBe('Viola CGDA');
    expect(findTuningName(cgda, { program: 105 })).toBe('Tenor banjo CGDA');
    expect(findTuningName(cgda)).toBe('Tenor banjo CGDA');
    expect(findTuningName(eadg, { program: 43 })).toBe('Double bass EADG');
    expect(findTuningName(eadg, { program: 33 })).toBe('Bass standard');
    expect(findTuningName(eadg)).toBe('Bass standard');
  });

  it('is ignored when the program names an instrument with no matching preset', () => {
    expect(findTuningName(cgda, { program: 24 })).toBe('Tenor banjo CGDA');
    expect(findTuningName(cgda, { program: 42 })).toBe('Tenor banjo CGDA');
    expect(findTuningName([55, 62, 69, 76], { program: 41 })).toBeUndefined();
    expect(findTuningName([40, 45, 50, 55, 59, 64], { program: 41 })).toBe('E standard');
  });

  it('tells the mandola and octave mandolin from the tenor banjos by their courses', () => {
    const unison = [0, 0, 0, 0];
    expect(findTuningName(cgda, { courses: unison })).toBe('Mandola CGDA');
    expect(findTuningName([43, 50, 57, 64], { courses: unison })).toBe('Octave mandolin GDAE');
    expect(findTuningName([43, 50, 57, 64])).toBe('Irish tenor banjo GDAE');
    expect(findTuningName([55, 62, 69, 76])).toBeUndefined();
    expect(findTuningName([55, 62, 69, 76], { program: 25 })).toBeUndefined();
    expect(findTuningName([55, 62, 69, 76], { program: 40 })).toBe('Violin GDAE');
    expect(findTuningName([55, 62, 69, 76], { courses: unison })).toBe('Mandolin GDAE');
  });
});
