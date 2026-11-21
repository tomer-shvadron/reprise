import { describe, expect, it } from 'vitest';

import { keyChanges, relationOf, viterbi } from './key-changes';
import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { chord, repeat, run, song, type SongBar } from './test/songs';

const C = 0;
const D = 2;
const A = 9;

/** I vi IV V, two bars each, with a scale run over it, in a major key. */
const majorLoop = (tonic: number, section?: string): SongBar[] =>
  [chord(tonic), chord(tonic + 9, true), chord(tonic + 5), chord(tonic + 7)].map(
    (voicing, index) => ({
      chord: voicing,
      melody: run(tonic),
      ...(index === 0 && section ? { section } : {}),
    }),
  );

function changesOf(bars: SongBar[], main: { tonic: number; quality: 'major' | 'minor' }) {
  const built = song(bars);
  const outline = songOutline(built);
  return keyChanges(noteTableOf(built), outline, main);
}

describe('keyChanges', () => {
  it('finds a last chorus a whole step up, in 8-bar windows', () => {
    const bars = [...repeat(majorLoop(C), 6), ...repeat(majorLoop(D), 4)];
    const changes = changesOf(bars, { tonic: C, quality: 'major' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      tonic: D,
      quality: 'major',
      name: 'D major',
      relation: 'up a whole step',
    });
    // The modulation falls at bar 24; the windows place it within a hop of it.
    expect(changes[0]?.fromBar).toBeGreaterThanOrEqual(20);
    expect(changes[0]?.fromBar).toBeLessThanOrEqual(28);
    expect(changes[0]?.toBar).toBe(39);
    expect(changes[0]?.gain).toBeGreaterThan(0.1);
  });

  it('uses the file sections as windows when it has two or more', () => {
    const bars = [
      ...repeat(majorLoop(C), 2).map((bar, index) =>
        index === 0 ? { ...bar, section: 'Verse' } : bar,
      ),
      ...majorLoop(C, 'Chorus'),
      ...repeat(majorLoop(D), 2).map((bar, index) =>
        index === 0 ? { ...bar, section: 'Last chorus' } : bar,
      ),
    ];
    const changes = changesOf(bars, { tonic: C, quality: 'major' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ fromBar: 12, toBar: 19, name: 'D major' });
  });

  it.each([
    ['a major song', repeat(majorLoop(C), 10), { tonic: C, quality: 'major' as const }],
    [
      'a minor song of the same notes',
      repeat(
        [chord(A, true), chord(A - 4), chord(A + 3), chord(A + 10)].map((voicing) => ({
          chord: voicing,
          melody: run(C),
        })),
        10,
      ),
      { tonic: A, quality: 'minor' as const },
    ],
  ])('reports no change for %s', (_name, bars, main) => {
    expect(changesOf(bars, main)).toEqual([]);
  });

  it('does not report a stretch shorter than 8 bars', () => {
    const bars = [...repeat(majorLoop(C), 6), ...majorLoop(D), ...repeat(majorLoop(C), 4)];
    expect(changesOf(bars, { tonic: C, quality: 'major' })).toEqual([]);
  });

  it('has nothing to say about a song with no key or too few bars', () => {
    const built = song(majorLoop(C));
    const outline = songOutline(built);
    expect(keyChanges(noteTableOf(built), outline, undefined)).toEqual([]);
    expect(keyChanges(noteTableOf(built), outline, { tonic: C, quality: 'major' })).toEqual([]);
  });
});

describe('viterbi', () => {
  it('stays on a key through a one-window blip that a change would not pay for', () => {
    const emissions = [
      [0.9, 0.1],
      [0.9, 0.1],
      [0.5, 0.7],
      [0.9, 0.1],
    ];
    expect(viterbi(emissions, 0.3)).toEqual([0, 0, 0, 0]);
    expect(viterbi(emissions, 0.05)).toEqual([0, 0, 1, 0]);
  });

  it('changes when the new key leads by more than the penalty, and handles no input', () => {
    expect(
      viterbi(
        [
          [1, 0],
          [1, 0],
          [0, 1],
          [0, 1],
          [0, 1],
        ],
        0.3,
      ),
    ).toEqual([0, 0, 1, 1, 1]);
    expect(viterbi([], 0.3)).toEqual([]);
  });
});

describe('relationOf', () => {
  const major = (tonic: number) => ({ tonic, quality: 'major' as const });
  const minor = (tonic: number) => ({ tonic, quality: 'minor' as const });

  it('names the relative and parallel keys and the step between tonics', () => {
    expect(relationOf(major(C), minor(A))).toBe('relative minor');
    expect(relationOf(minor(A), major(C))).toBe('relative major');
    expect(relationOf(major(C), minor(C))).toBe('parallel minor');
    expect(relationOf(minor(A), major(A))).toBe('parallel major');
    expect(relationOf(major(C), major(D))).toBe('up a whole step');
    expect(relationOf(major(C), major(1))).toBe('up a half step');
    expect(relationOf(major(C), major(7))).toBe('down a fourth');
    expect(relationOf(major(C), major(10))).toBe('down a whole step');
  });
});
