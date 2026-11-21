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

/** `count` bars of I vi IV V in `tonic`, starting on I, with a scale run over them. */
const barsIn = (tonic: number, count: number, section?: string): SongBar[] =>
  Array.from({ length: count }, (_, index) => {
    const [voicing] = [
      chord(tonic),
      chord(tonic + 9, true),
      chord(tonic + 5),
      chord(tonic + 7),
    ].slice(index % 4);
    return {
      chord: voicing ?? chord(tonic),
      melody: run(tonic),
      ...(index === 0 && section ? { section } : {}),
    };
  });

const spans = (bars: SongBar[]) =>
  changesOf(bars, { tonic: C, quality: 'major' }).map(({ fromBar, toBar, name }) => [
    fromBar,
    toBar,
    name,
  ]);

describe('keyChanges, exact boundaries', () => {
  it.each([
    [24, 1, 'D♭ major'],
    [28, 1, 'D♭ major'],
    [32, 1, 'D♭ major'],
    [26, 1, 'D♭ major'],
    [24, 2, 'D major'],
    [26, 2, 'D major'],
    [30, 2, 'D major'],
  ])('finds an 8-bar last chorus after %i bars of C, up %i semitones', (before, up, name) => {
    expect(spans([...barsIn(C, before), ...barsIn(up, 8)])).toEqual([[before, before + 7, name]]);
  });

  it('finds an 8-bar excursion in the middle, to the bar', () => {
    expect(spans([...barsIn(C, 16), ...barsIn(D, 8), ...barsIn(C, 16)])).toEqual([
      [16, 23, 'D major'],
    ]);
  });

  it('finds a modulation inside one long section', () => {
    const bars = [...barsIn(C, 4, 'Intro'), ...barsIn(C, 24, 'Song'), ...barsIn(1, 16)];
    expect(spans(bars)).toEqual([[28, 43, 'D♭ major']]);
  });

  it('reports both identical relative-major choruses, not only the last', () => {
    const verse = (section: string): SongBar[] =>
      [chord(A, true), chord(2, true), chord(4), chord(A, true)].flatMap((voicing, index) =>
        [0, 1].map((half) => ({
          chord: voicing,
          melody: [69, 71, 72, 74, 76, 77, 80, 81],
          ...(index === 0 && half === 0 ? { section } : {}),
        })),
      );
    const chorus = (section: string): SongBar[] =>
      [chord(C), chord(5), chord(7), chord(C), chord(C), chord(5), chord(7), chord(C)].map(
        (voicing, index) => ({
          chord: voicing,
          melody: run(C),
          ...(index === 0 ? { section } : {}),
        }),
      );
    const changes = changesOf(
      [...verse('Verse'), ...chorus('Chorus'), ...verse('Verse 2'), ...chorus('Chorus 2')],
      { tonic: A, quality: 'minor' },
    );
    expect(changes.map(({ fromBar, toBar, relation }) => [fromBar, toBar, relation])).toEqual([
      [8, 15, 'relative major'],
      [24, 31, 'relative major'],
    ]);
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

  it('charges an excursion the same wherever it sits when anchored', () => {
    const lead = [0.4, 0.6]; // the new key leads by 0.2 for two steps
    const home = [0.9, 0.1];
    const middle = [home, home, lead, lead, home, home];
    const end = [home, home, home, home, lead, lead];
    // Unanchored, the tail pays once and the middle twice; anchored, both pay twice.
    expect(viterbi(middle, 0.25)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(viterbi(end, 0.25)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(viterbi(end, 0.25, 0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(viterbi([home, lead, lead, lead, lead, lead, lead], 0.15, 0)).toEqual([
      0, 1, 1, 1, 1, 1, 1,
    ]);
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
    expect(relationOf(major(C), major(7))).toBe('up a fifth');
    expect(relationOf(major(C), major(10))).toBe('up a minor seventh');
  });
});
