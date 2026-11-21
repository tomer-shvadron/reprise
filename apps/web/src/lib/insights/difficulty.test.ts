import type { Bend, BeatEffects } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { BANDS, MIN_RATED_NOTES, WEIGHTS, bandOf, difficultyOf } from './difficulty';
import { noteTableOf } from './note-table';
import { songOutline } from './outline';

const WHOLE_TONE: Bend = {
  kind: 'bend',
  points: [
    { position: 0, value: 0 },
    { position: 60, value: 4 },
  ],
};

interface Part {
  tempo?: number;
  bars?: number;
  /** Beats per bar: 4 are quarters, 8 eighths, 16 sixteenths. */
  perBar?: 4 | 8 | 16;
  /** The frets struck on beat `i`, one per string from the first. */
  frets?: (i: number) => number[];
  effects?: BeatEffects;
  /** Beats that carry a bend of a whole tone. */
  bend?: (i: number) => boolean;
  /** Beats that carry a slide. */
  slide?: (i: number) => boolean;
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
        perBar === 4 ? '4' : perBar === 8 ? '8' : '16',
        frets(i).map((fret, string) =>
          note(string + 1, fret, {
            ...(part.bend?.(i) ? { bend: WHOLE_TONE } : {}),
            ...(part.slide?.(i) ? { slide: ['shift' as const] } : {}),
          }),
        ),
        effects ? { effects } : {},
      );
      i++;
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

  it('rises with the stretch of the hand, leaving open strings out', () => {
    const wide = rate({ frets: () => [1, 6] });
    expect(factor(wide, 'stretch')?.value).toBe(5);
    expect(factor(wide, 'stretch')?.band).toBe(4);
    expect(wide?.score).toBeGreaterThan(easy?.score ?? 0);
    expect(factor(rate({ frets: () => [0, 5] }), 'stretch')?.value).toBe(0);
  });

  it('counts a span of more than five frets as a shift of position, not a stretch', () => {
    expect(factor(rate({ frets: () => [1, 8] }), 'stretch')?.value).toBe(0);
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

  it('rates a fast single-note line in one box 4 on speed alone', () => {
    // 16ths at 180 is 12 notes a second; nothing else about it is hard.
    const sprint = rate({ tempo: 180, perBar: 16, frets: (i) => [5 + (i % 4)] });
    expect(factor(sprint, 'speed')?.band).toBe(5);
    expect(factor(sprint, 'stretch')?.band).toBeLessThanOrEqual(2);
    expect(factor(sprint, 'techniques')?.band).toBe(1);
    expect(sprint?.rating).toBe(4);
  });

  it('rates a fast, high, bend-heavy single-note solo 5', () => {
    const solo = rate({
      tempo: 170,
      perBar: 16,
      frets: (i) => [[12, 19, 14, 22][i % 4] ?? 12],
      bend: (i) => i % 2 === 0,
    });
    expect(solo?.rating).toBe(5);
  });

  it('measures the stretch across consecutive notes, not only within a beat', () => {
    // Alternating frets 1 and 4, one note a beat: 16ths share a quarter-note window, quarters do not.
    const spread = rate({ tempo: 80, perBar: 16, frets: (i) => [[1, 4][i % 2] ?? 1] });
    expect(factor(spread, 'stretch')?.value).toBe(3);
    const slow = rate({ tempo: 80, perBar: 4, frets: (i) => [[1, 4][i % 2] ?? 1] });
    expect(factor(slow, 'stretch')?.value).toBe(0);
  });

  it('keeps an easy melody at 1 or 2 through one slide, one shift or one high note', () => {
    const melody = (frets: (i: number) => number[]) => rate({ tempo: 80, perBar: 8, frets });
    // 8 bars of eighths in open position, with a single event in the middle.
    const plain = melody(() => [3]);
    const high = melody((i) => [i === 31 ? 20 : 3]);
    const shifted = melody((i) => [i >= 31 && i < 33 ? 10 : 3]);
    const slid = rate({
      tempo: 80,
      perBar: 8,
      frets: (i) => [i === 31 ? 8 : 3],
      slide: (i) => i === 31,
    });
    for (const part of [plain, high, shifted, slid]) {
      expect(part?.rating).toBeLessThanOrEqual(2);
    }
    expect(factor(high, 'fret')?.band).toBe(1);
  });

  it('rates a slow, high, bend-heavy solo at least 3, and the shred box still 4', () => {
    // 8ths at 70 bpm, frets 15 to 20, a whole-tone bend on every fourth note.
    const blues = rate({
      tempo: 70,
      perBar: 8,
      frets: (i) => [[15, 17, 20, 18][i % 4] ?? 15],
      bend: (i) => i % 4 === 0,
    });
    expect(blues?.rating).toBeGreaterThanOrEqual(3);
    const shred = rate({ tempo: 180, perBar: 16, frets: (i) => [5 + (i % 4)] });
    expect(shred?.rating).toBe(4);
  });

  it('keeps an open-chord strum at 1 or 2', () => {
    const G = [3, 0, 0, 0, 2, 3];
    const C = [0, 1, 0, 2, 3, 0];
    const eighths = rate({ tempo: 120, perBar: 8, frets: (i) => (i % 8 < 4 ? G : C) });
    const sixteenths = rate({ tempo: 100, perBar: 16, frets: (i) => (i % 16 < 8 ? G : C) });
    expect(eighths?.rating).toBe(1);
    expect(sixteenths?.rating).toBeLessThanOrEqual(2);
  });

  it('keeps the rating between 1 and 5 and rounds the weighted mean', () => {
    const hard = rate({
      tempo: 220,
      perBar: 8,
      frets: (i) => [i % 2 === 0 ? 1 : 22, i % 2 === 0 ? 8 : 22],
      effects: { tapping: true },
    });
    expect(hard?.rating).toBeGreaterThanOrEqual(4);
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
