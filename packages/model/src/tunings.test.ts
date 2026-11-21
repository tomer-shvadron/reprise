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
  ])('%s is %s', (name, _notes, strings) => {
    expect(STANDARD_TUNINGS.find((tuning) => tuning.name === name)?.strings).toEqual(strings);
    expect(findTuningName(strings)).toBe(name);
  });

  it('has unique names and tunings that fit a track', () => {
    expect(new Set(STANDARD_TUNINGS.map(({ name }) => name)).size).toBe(STANDARD_TUNINGS.length);
    const keys = STANDARD_TUNINGS.map(({ strings, courses, drone }) =>
      [
        strings.join(','),
        courses?.join(',') ?? '',
        drone ? `${String(drone.string)}@${String(drone.fret)}` : '',
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
