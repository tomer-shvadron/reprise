import type { BeatEffects } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { BANDS, MIN_RATED_NOTES, WEIGHTS, bandOf, difficultyOf } from './difficulty';
import { noteTableOf } from './note-table';
import { songOutline } from './outline';

interface Part {
  tempo?: number;
  bars?: number;
  /** Beats per bar: 4 are quarters, 8 eighths. */
  perBar?: 4 | 8;
  /** The frets struck on beat `i`, one per string from the first. */
  frets?: (i: number) => number[];
  effects?: BeatEffects;
}

/** A guitar part that is easy on every factor until a field says otherwise. */
function rate(part: Part = {}) {
  const { tempo = 80, bars = 8, perBar = 4, frets = () => [5], effects } = part;
  const builder = score().tempo(tempo).track('guitar');
  let i = 0;
  for (let bar = 0; bar < bars; bar++) {
    builder.bar();
    for (let slot = 0; slot < perBar; slot++) {
      builder.beat(
        perBar === 4 ? '4' : '8',
        frets(i++).map((fret, string) => note(string + 1, fret)),
        effects ? { effects } : {},
      );
    }
  }
  const built = builder.build();
  return difficultyOf(noteTableOf(built), songOutline(built), 'fretted');
}

const factor = (result: ReturnType<typeof rate>, id: string) =>
  result?.factors.find((f) => f.id === id);

describe('difficultyOf', () => {
  const easy = rate();

  it('rates a slow part on one position as 1 and shows every factor', () => {
    expect(easy?.rating).toBe(1);
    expect(easy?.factors.map((f) => f.id)).toEqual([
      'speed',
      'shifts',
      'stretch',
      'techniques',
      'fret',
    ]);
    expect(easy?.factors.every((f) => f.band === 1)).toBe(true);
  });

  it('rises with speed', () => {
    const fast = rate({ tempo: 200, perBar: 8 });
    expect(factor(fast, 'speed')?.band).toBeGreaterThanOrEqual(4);
    expect(fast?.score).toBeGreaterThan(easy?.score ?? 0);
  });

  it('rises with position shifts', () => {
    const jumpy = rate({ frets: (i) => [i % 2 === 0 ? 2 : 12] });
    expect(factor(jumpy, 'shifts')?.band).toBeGreaterThanOrEqual(4);
    expect(jumpy?.score).toBeGreaterThan(easy?.score ?? 0);
  });

  it('rises with the widest stretch, leaving open strings out', () => {
    const wide = rate({ frets: () => [1, 8] });
    expect(factor(wide, 'stretch')?.value).toBe(7);
    expect(factor(wide, 'stretch')?.band).toBe(5);
    expect(wide?.score).toBeGreaterThan(easy?.score ?? 0);
    expect(factor(rate({ frets: () => [0, 5] }), 'stretch')?.value).toBe(0);
  });

  it('rises with the share of demanding techniques', () => {
    const tapped = rate({ effects: { tapping: true } });
    expect(factor(tapped, 'techniques')?.value).toBe(1);
    expect(factor(tapped, 'techniques')?.band).toBe(5);
    expect(tapped?.score).toBeGreaterThan(easy?.score ?? 0);
  });

  it('rises with the highest fret', () => {
    const high = rate({ frets: () => [22] });
    expect(factor(high, 'fret')).toMatchObject({ value: 22, band: 5 });
    expect(high?.score).toBeGreaterThan(easy?.score ?? 0);
  });

  it('keeps the rating between 1 and 5 and rounds the weighted mean', () => {
    const hard = rate({
      tempo: 220,
      perBar: 8,
      frets: (i) => [i % 2 === 0 ? 1 : 22, i % 2 === 0 ? 8 : 22],
      effects: { tapping: true },
    });
    expect(hard?.rating).toBe(5);
    expect(hard?.rating).toBe(Math.round(hard?.score ?? 0));
  });

  it('counts only speed and techniques on a pitched track', () => {
    const built = score()
      .track('piano')
      .bar()
      .beat('4', [note(0, 60)])
      .beat('4', [note(0, 62)])
      .beat('4', [note(0, 64)])
      .beat('4', [note(0, 65)])
      .bar()
      .beat('4', [note(0, 67)])
      .beat('4', [note(0, 69)])
      .beat('4', [note(0, 71)])
      .beat('4', [note(0, 72)])
      .build();
    const result = difficultyOf(noteTableOf(built), songOutline(built), 'pitched');
    expect(result?.factors.map((f) => f.id)).toEqual(['speed', 'techniques']);
  });

  it('rates no drum track and no track with too few notes', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 3)])
      .build();
    expect(MIN_RATED_NOTES).toBeGreaterThan(1);
    expect(difficultyOf(noteTableOf(built), songOutline(built), 'fretted')).toBeUndefined();
    expect(difficultyOf(noteTableOf(built), songOutline(built), 'drums')).toBeUndefined();
  });
});

describe('bands', () => {
  it('place a value by its upper bounds', () => {
    expect(bandOf(0, [2, 4, 6, 9])).toBe(1);
    expect(bandOf(2, [2, 4, 6, 9])).toBe(1);
    expect(bandOf(2.1, [2, 4, 6, 9])).toBe(2);
    expect(bandOf(100, [2, 4, 6, 9])).toBe(5);
  });

  it('rise for every factor and the weights make speed the largest', () => {
    for (const bounds of Object.values(BANDS)) {
      expect([...bounds].sort((a, b) => a - b)).toEqual([...bounds]);
    }
    expect(Math.max(...Object.values(WEIGHTS))).toBe(WEIGHTS.speed);
  });
});
