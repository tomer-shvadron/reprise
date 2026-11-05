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
  ])('%s is %s', (name, _notes, strings) => {
    expect(STANDARD_TUNINGS.find((tuning) => tuning.name === name)?.strings).toEqual(strings);
    expect(findTuningName(strings)).toBe(name);
  });

  it('has unique names and tunings that fit a track', () => {
    expect(new Set(STANDARD_TUNINGS.map(({ name }) => name)).size).toBe(STANDARD_TUNINGS.length);
    const keys = STANDARD_TUNINGS.map(({ strings }) => strings.join(','));
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
