import { createHistory } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { clipSummary, copyClip, planCut } from './clip';
import { barsRange, beatsRange, clipboardScore, cursorAt } from './test/clip-scores';
import { must } from './test/must';

const none = { cursor: undefined, range: undefined };

function copied(...args: Parameters<typeof copyClip>) {
  const result = copyClip(...args);
  if ('refused' in result) throw new Error(result.refused);
  return result.clip;
}

describe('copyClip', () => {
  const built = clipboardScore();

  it('takes the beats of a range in one voice, with the bar it came from', () => {
    const clip = copied(built, {
      ...none,
      range: beatsRange(built, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    expect(clip).toMatchObject({ version: 1, kind: 'beats' });
    expect(clip.tracks).toHaveLength(1);
    const [bar] = must(clip.tracks[0]).bars;
    expect(bar?.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(bar?.voices).toHaveLength(1);
    expect(bar?.voices[0]?.beats.map(({ notes }) => notes[0]?.fret)).toEqual([2, 3]);
    expect(clipSummary(clip)).toBe('2 beats');
  });

  it('keeps each voice of a range with its offset from the range start', () => {
    const two = (() => {
      const built = score().track('guitar');
      built
        .bar()
        .beat('4', [note(1, 1)])
        .beat('4', [note(1, 2)])
        .beat('2', [note(1, 3)])
        .voice(1)
        .beat('2', [note(2, 4)])
        .beat('2', [note(2, 5)]);
      return built.build({ ids: 'sequential' });
    })();
    const clip = copied(two, {
      ...none,
      range: beatsRange(two, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    const voices = must(clip.tracks[0]).bars[0]?.voices ?? [];
    expect(voices.map(({ voice }) => voice)).toEqual([0, 1]);
    // The range starts on the second quarter (tick 960); voice 1's first half is before it, its second starts 960 in.
    expect(voices[0]?.beats).toHaveLength(2);
    expect(voices[1]?.beats).toHaveLength(1);
    expect(voices[1]?.offset).toBe(960);
  });

  it('takes every visible track from the anchor down, across bars', () => {
    const clip = copied(built, {
      ...none,
      range: beatsRange(built, { first: 0, last: 1, bar: 0, lastBar: 1, from: 2, to: 1 }),
    });
    expect(clip.tracks.map(({ name }) => name)).toEqual(['Lead', 'Rhythm']);
    expect(must(clip.tracks[0]).bars).toHaveLength(2);
    expect(clipSummary(clip)).toBe('4 beats in 2 tracks');
  });

  it('leaves out a hidden track', () => {
    const [lead, rhythm] = built.tracks;
    const clip = copied(
      built,
      { ...none, range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 1 }) },
      [must(lead).id],
    );
    expect(clip.tracks).toHaveLength(1);
    expect(rhythm).toBeDefined();
  });

  it('takes whole bars with all four voices, empty ones included', () => {
    const clip = copied(built, { ...none, range: barsRange(built, { first: 0, from: 1, to: 3 }) });
    expect(clip.kind).toBe('bars');
    const bars = must(clip.tracks[0]).bars;
    expect(bars).toHaveLength(3);
    expect(bars.every(({ voices }) => voices.length === 4)).toBe(true);
    expect(bars[2]?.voices.every(({ beats }) => beats.length === 0)).toBe(true);
    expect(clipSummary(clip)).toBe('3 bars');
  });

  it('takes the beat under the cursor when nothing is selected', () => {
    const clip = copied(built, { cursor: cursorAt(built, 0, 0, 2), range: undefined });
    expect(clip.kind).toBe('beats');
    expect(
      must(clip.tracks[0]).bars[0]?.voices[0]?.beats.map(({ notes }) => notes[0]?.fret),
    ).toEqual([3]);
  });

  it('refuses with nothing to take: no cursor, or the end slot', () => {
    expect(copyClip(built, none)).toHaveProperty('refused');
    const end = copyClip(built, { cursor: cursorAt(built, 0, 3, 0), range: undefined });
    expect(end).toHaveProperty('refused');
  });

  it('clears a tie that reaches back before the clip and keeps one inside it', () => {
    const tied = (() => {
      const built = score().track('guitar');
      built
        .bar()
        .beat('4', [note(1, 5)])
        .beat('4', [note(1, 5, { tie: true })])
        .beat('4', [note(1, 5, { tie: true })]);
      return built.build({ ids: 'sequential' });
    })();
    const clip = copied(tied, {
      ...none,
      range: beatsRange(tied, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    const beats = must(clip.tracks[0]).bars[0]?.voices[0]?.beats ?? [];
    expect(beats.map(({ notes }) => notes[0]?.tie)).toEqual([false, true]);
  });
});

describe('planCut', () => {
  const built = clipboardScore();

  it('removes the beats of a range as one undo step and leaves the bar unfilled', () => {
    const plan = planCut(built, {
      ...none,
      range: beatsRange(built, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    if ('refused' in plan) throw new Error(plan.refused);
    const history = createHistory();
    const after = history.apply(built, plan.command).score;
    expect(after.tracks[0]?.bars[0]?.voices[0]?.beats.map(({ notes }) => notes[0]?.fret)).toEqual([
      1, 4,
    ]);
    expect(history.steps).toHaveLength(1);
    expect(history.undoLabel).toBe('cutBeats');
    expect(after.masterBars).toHaveLength(built.masterBars.length);
  });

  it('empties the bars of a bars range in its tracks and keeps the bars', () => {
    const plan = planCut(built, {
      ...none,
      range: barsRange(built, { first: 0, last: 1, from: 0, to: 1 }),
    });
    if ('refused' in plan) throw new Error(plan.refused);
    const history = createHistory();
    const after = history.apply(built, plan.command).score;
    for (const track of [0, 1]) {
      for (const bar of [0, 1]) {
        expect(
          after.tracks[track]?.bars[bar]?.voices.every(({ beats }) => beats.length === 0),
        ).toBe(true);
      }
    }
    expect(after.tracks[2]?.bars[0]?.voices[0]?.beats).toHaveLength(4);
    expect(after.masterBars).toHaveLength(built.masterBars.length);
    expect(history.undoLabel).toBe('cutBars');
    expect(history.undo()?.score).toEqual(built);
  });

  it('cuts the cursor beat without a range, and refuses with nothing there', () => {
    const plan = planCut(built, { cursor: cursorAt(built, 0, 0, 0), range: undefined });
    expect('refused' in plan).toBe(false);
    expect(planCut(built, none)).toHaveProperty('refused');
  });
});
