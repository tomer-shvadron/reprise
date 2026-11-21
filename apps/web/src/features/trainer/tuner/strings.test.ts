import { STANDARD_TUNINGS, type Track } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { pickString, stringTargets, windowFor } from './strings';

const tuning = (name: string) => {
  const found = STANDARD_TUNINGS.find((t) => t.name === name);
  if (!found) throw new Error(name);
  return [...found.strings];
};
const fretted = (name: string, capo = 0): Pick<Track, 'kind' | 'tuning' | 'capo'> => ({
  kind: 'fretted',
  tuning: tuning(name),
  capo,
});

describe('stringTargets tuning names', () => {
  it('names a 12-string by its courses and a banjo by its drone', () => {
    const twelve = { ...fretted('E standard'), courses: [12, 12, 12, 12, 0, 0] };
    expect(stringTargets(twelve, 440)?.tuningName).toBe('12-string standard');
    const banjo = { ...fretted('Banjo Open G'), drone: { string: 5, fret: 5 } };
    expect(stringTargets(banjo, 440)?.tuningName).toBe('Banjo Open G');
  });
});

describe('stringTargets', () => {
  it('lists standard guitar from the lowest string, with the track string numbers', () => {
    const set = stringTargets(fretted('E standard'), 440);
    expect(set?.targets.map((t) => [t.string, t.midi])).toEqual([
      [6, 40],
      [5, 45],
      [4, 50],
      [3, 55],
      [2, 59],
      [1, 64],
    ]);
    expect(set?.targets[1]?.hz).toBeCloseTo(110, 6);
    expect(set?.tuningName).toBe('E standard');
  });

  it('follows the reference', () => {
    expect(stringTargets(fretted('E standard'), 432)?.targets[1]?.hz).toBeCloseTo(108, 6);
  });

  it('names drop D and covers 7-string and bass tunings', () => {
    expect(stringTargets(fretted('Drop D'), 440)?.targets[0]?.midi).toBe(38);
    expect(stringTargets(fretted('Drop D'), 440)?.tuningName).toBe('Drop D');
    expect(stringTargets(fretted('7-string standard'), 440)?.targets).toHaveLength(7);
    expect(stringTargets(fretted('Bass standard'), 440)?.targets[0]?.midi).toBe(28);
    expect(stringTargets(fretted('5-string bass standard'), 440)?.targets[0]?.midi).toBe(23);
  });

  it('adds the capo to every target', () => {
    const set = stringTargets(fretted('E standard', 2), 440);
    expect(set?.capo).toBe(2);
    expect(set?.targets[0]?.midi).toBe(42);
  });

  it('has nothing for drums, a pitched track or no track', () => {
    expect(stringTargets(undefined, 440)).toBeUndefined();
    expect(stringTargets({ kind: 'drums', tuning: [], capo: 0 }, 440)).toBeUndefined();
    expect(
      stringTargets({ kind: 'pitched', tuning: tuning('E standard'), capo: 0 }, 440),
    ).toBeUndefined();
  });
});

describe('pickString', () => {
  const targets = stringTargets(fretted('E standard'), 440)?.targets ?? [];

  it('takes the nearest target within 300 cents', () => {
    expect(pickString(targets, 45.12, undefined)?.string).toBe(5);
    expect(pickString(targets, 41.2, undefined)?.string).toBe(6);
    expect(pickString(targets, 36.5, undefined)).toBeUndefined();
    expect(pickString(targets, 70, undefined)).toBeUndefined();
  });

  it('keeps the string until another is 50 cents nearer', () => {
    // Between A2 (45) and D3 (50), near D: 47.4 is 2.4 from A and 2.6 from D.
    expect(pickString(targets, 47.4, 5)?.string).toBe(5);
    expect(pickString(targets, 47.4, 4)?.string).toBe(4);
    // Closer to D by more than half a semitone.
    expect(pickString(targets, 48.1, 5)?.string).toBe(4);
  });
});

describe('windowFor', () => {
  it.each([44100, 48000])('picks the window by the lowest target at %i Hz', (rate) => {
    const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
    expect(windowFor(rate, hz(40))).toBe(2048);
    expect(windowFor(rate, hz(36))).toBe(2048);
    expect(windowFor(rate, hz(35))).toBe(2048);
    expect(windowFor(rate, hz(28))).toBe(4096);
    expect(windowFor(rate, hz(23))).toBe(4096);
    expect(windowFor(rate, 30)).toBe(4096);
  });
});
