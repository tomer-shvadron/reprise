import { applyCommand, createEmptyScore, type Score } from '@reprise/model';
import { note, score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  barTarget,
  deleteBlocker,
  planDeleteBars,
  planInsertBar,
  planToggleRepeatEnd,
  planToggleRepeatStart,
  targetOf,
} from './bar-edit';
import { cursorAtPosition } from './cursor';
import { rangeBetween } from './range';
import { must } from './test/must';

function bars(count: number): Score {
  let score = createEmptyScore();
  for (let at = 1; at < count; at++) {
    const target = must(targetOf([must(score.masterBars.at(-1), 'last bar').id]), 'target');
    score = applyCommand(score, must(planInsertBar(score, target, 'after'), 'plan').command).score;
  }
  return score;
}

const ids = (score: Score) => score.masterBars.map(({ id }) => id);

describe('planInsertBar', () => {
  it('inserts before the first bar and after the last bar of a target', () => {
    const score = bars(4);
    const [a, b, c] = ids(score);
    const target = must(targetOf([must(b), must(c)]));
    const before = must(planInsertBar(score, target, 'before'));
    const after = must(planInsertBar(score, target, 'after'));
    expect(applyCommand(score, before.command).score.masterBars[1]?.id).toBe(before.bar);
    const next = applyCommand(score, after.command).score;
    expect(next.masterBars[3]?.id).toBe(after.bar);
    expect(next.masterBars[0]?.id).toBe(a);
  });

  it('moves the tempo mark onto a bar inserted before bar 1', () => {
    const score = bars(1);
    const plan = must(planInsertBar(score, must(targetOf(ids(score))), 'before'));
    const next = applyCommand(score, plan.command).score;
    expect(next.masterBars[0]?.tempo).toEqual({ bpm: 120 });
    expect(next.masterBars[1]?.tempo).toBeUndefined();
  });
});

describe('planDeleteBars', () => {
  it('removes exactly the target bars, and the tempo carries on', () => {
    const score = bars(5);
    const all = ids(score);
    const target = must(targetOf(all.slice(0, 2)));
    const next = applyCommand(score, must(planDeleteBars(score, target))).score;
    expect(ids(next)).toEqual(all.slice(2));
    expect(next.masterBars[0]?.tempo).toEqual({ bpm: 120 });
  });

  it('is refused up front when the target is every bar', () => {
    const score = bars(3);
    const target = must(targetOf(ids(score)));
    expect(deleteBlocker(score, target)).toBe('A score keeps at least one bar');
    expect(deleteBlocker(bars(4), target)).toBeUndefined();
  });
});

describe('the repeat toggles', () => {
  it('start goes on the first bar, end on the last, and both toggle back', () => {
    let score = bars(3);
    const target = must(targetOf(ids(score).slice(0, 2)));
    score = applyCommand(score, must(planToggleRepeatStart(score, target))).score;
    score = applyCommand(score, must(planToggleRepeatEnd(score, target))).score;
    expect(score.masterBars.map(({ repeat }) => repeat)).toEqual([
      { start: true, endCount: 0 },
      { start: false, endCount: 2 },
      { start: false, endCount: 0 },
    ]);
    score = applyCommand(score, must(planToggleRepeatEnd(score, target))).score;
    expect(score.masterBars[1]?.repeat.endCount).toBe(0);
  });
});

describe('barTarget', () => {
  const built = scoreBuilder().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 1)]);
  built.bar().beat('4', [note(1, 2)]);
  built.bar().beat('4', [note(1, 3)]);
  const song = built.build();
  const at = (bar: number) =>
    must(cursorAtPosition(song, { track: 0, bar, voice: 0, stop: 0 }, { string: 1, staff: 'tab' }));

  it('is nothing without a cursor or a range', () => {
    expect(barTarget(song, { cursor: undefined, range: undefined })).toBeUndefined();
  });

  it('is the cursor bar without a range', () => {
    const target = barTarget(song, { cursor: at(1), range: undefined });
    expect(target?.ids).toEqual([song.masterBars[1]?.id]);
  });

  it('takes every bar a beats range touches', () => {
    const range = rangeBetween(song, at(0), at(1));
    const target = barTarget(song, { cursor: at(1), range });
    expect(target).toMatchObject({
      ids: [song.masterBars[0]?.id, song.masterBars[1]?.id],
      first: song.masterBars[0]?.id,
      last: song.masterBars[1]?.id,
    });
  });
});
