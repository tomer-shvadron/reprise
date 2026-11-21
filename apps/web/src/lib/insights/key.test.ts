import { midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { CONFIDENCE, confidenceOf, detectKey, pearson, rankKeys, tonicByCues } from './key';
import { PROFILE_SETS, profileSetOf } from './key-profiles';
import { noteTableOf } from './note-table';
import { fromBars } from './test/corpus';

describe('pearson', () => {
  it('is 1 for a scaled copy, -1 for a mirror and 0 for no spread', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe('profiles', () => {
  it.each(PROFILE_SETS)('$name has twelve weights per mode and a citation', (set) => {
    expect(set.major).toHaveLength(12);
    expect(set.minor).toHaveLength(12);
    expect(set.citation.length).toBeGreaterThan(20);
    // The tonic is the heaviest degree of a major profile.
    expect(Math.max(...set.major)).toBe(set.major[0]);
  });

  it.each(PROFILE_SETS)('$name ranks a rotated profile as its own key', (set) => {
    for (const tonic of [0, 3, 8]) {
      const histogram = Array.from(
        { length: 12 },
        (_, pc) => set.minor[(pc - tonic + 12) % 12] ?? 0,
      );
      const best = rankKeys(histogram, set)[0];
      expect(best).toMatchObject({ tonic, quality: 'minor' });
    }
  });

  it('looks a set up by id', () => {
    expect(profileSetOf('temperley').name).toBe('Temperley');
  });
});

describe('confidenceOf', () => {
  it('grades by the best correlation and the gap to the runner-up', () => {
    expect(confidenceOf(0.9, 0.7)).toBe('high');
    expect(confidenceOf(0.7, 0.6)).toBe('medium');
    expect(confidenceOf(0.9, 0.9 - CONFIDENCE.mediumGap / 2)).toBe('low');
  });
});

describe('detectKey', () => {
  const triad = (root: number, third: number) => [root, root + third, root + 7];

  it('names C major from a I-IV-V-I and agrees with the file', () => {
    const table = noteTableOf(
      fromBars([
        { chord: [36, ...triad(60, 4)] },
        { chord: [41, ...triad(65, 4)] },
        { chord: [43, ...triad(67, 4)] },
        { chord: [36, ...triad(60, 4)] },
      ]),
    );
    const key = detectKey(table, { fileKey: { fifths: 0, minor: false } });
    expect(key).toMatchObject({ found: true, tonic: 0, quality: 'major', name: 'C major' });
    expect(key.found && key.agreesWithFile).toBe(true);
    expect(key.found && key.scale?.scale).toBe('ionian');
  });

  it('spells a flat key with flats', () => {
    const shift = 3;
    const table = noteTableOf(
      fromBars([
        { chord: [36 + shift, ...triad(60 + shift, 3)] },
        { chord: [41 + shift, ...triad(65 + shift, 3)] },
        { chord: [43 + shift, ...triad(67 + shift, 4)] },
        { chord: [36 + shift, ...triad(60 + shift, 3)] },
      ]),
    );
    expect(detectKey(table)).toMatchObject({ tonic: 3, quality: 'minor', name: 'E♭ minor' });
  });

  it('says so when there are too few notes', () => {
    const table = noteTableOf(
      score()
        .track('piano')
        .bar()
        .beat('1', [midi(60)])
        .build(),
    );
    expect(detectKey(table)).toEqual({ found: false, reason: 'not-enough-notes' });
  });

  it('keeps the tonic of a power-chord riff and does not guess a mode', () => {
    const power = (root: number) => [root, root + 7, root + 12];
    const table = noteTableOf(
      fromBars([40, 40, 45, 45, 40, 40, 47, 45, 40].map((root) => ({ chord: power(root) }))),
    );
    expect(detectKey(table)).toMatchObject({ found: true, tonic: 4, quality: 'none' });
  });

  it('names the tonic of a minor and major-IV vamp', () => {
    // An A minor and D major vamp: A Dorian.
    const am = [45, 57, 60, 64];
    const d = [38, 57, 62, 66];
    const table = noteTableOf(
      fromBars([am, am, d, am, am, am, d, am, am].map((chord) => ({ chord }))),
    );
    const key = detectKey(table);
    expect(key.found && key.tonic).toBe(9);
    expect(key.found && key.quality).toBe('minor');
  });

  it('leaves the tonic alone when the cues disagree', () => {
    const table = noteTableOf(
      fromBars([
        { chord: [48, 60, 64, 67] },
        { chord: [43, 55, 59, 62] },
        { chord: [45, 57, 60, 64] },
        { chord: [41, 53, 57, 60] },
      ]),
    );
    expect(tonicByCues(table)).toBeUndefined();
  });
});
