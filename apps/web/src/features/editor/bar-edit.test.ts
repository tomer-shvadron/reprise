import { applyCommand, createEmptyScore, type Score } from '@reprise/model';
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

function bars(count: number): Score {
  let score = createEmptyScore();
  for (let at = 1; at < count; at++) {
    const last = score.masterBars.at(-1)?.id ?? '';
    const target = targetOf([last]);
    const plan = target && planInsertBar(score, target, 'after');
    if (!plan) throw new Error('no plan');
    score = applyCommand(score, plan.command).score;
  }
  return score;
}

const ids = (score: Score) => score.masterBars.map(({ id }) => id);

describe('planInsertBar', () => {
  it('inserts before the first bar and after the last bar of a target', () => {
    const score = bars(4);
    const [a, b, c] = ids(score);
    const target = targetOf([b ?? '', c ?? '']);
    if (!target) throw new Error('no target');
    const before = planInsertBar(score, target, 'before');
    const after = planInsertBar(score, target, 'after');
    expect(applyCommand(score, before?.command ?? ({} as never)).score.masterBars[1]?.id).toBe(
      before?.bar,
    );
    const next = applyCommand(score, after?.command ?? ({} as never)).score;
    expect(next.masterBars[3]?.id).toBe(after?.bar);
    expect(next.masterBars[0]?.id).toBe(a);
  });

  it('moves the tempo mark onto a bar inserted before bar 1', () => {
    const score = bars(1);
    const target = targetOf(ids(score));
    const plan = target && planInsertBar(score, target, 'before');
    const next = applyCommand(score, plan?.command ?? ({} as never)).score;
    expect(next.masterBars[0]?.tempo).toEqual({ bpm: 120 });
    expect(next.masterBars[1]?.tempo).toBeUndefined();
  });
});

describe('planDeleteBars', () => {
  it('removes exactly the target bars, from the highest index down, and the tempo carries on', () => {
    const score = bars(5);
    const all = ids(score);
    const target = targetOf(all.slice(0, 2));
    const command = target && planDeleteBars(score, target);
    const next = applyCommand(score, command ?? ({} as never)).score;
    expect(ids(next)).toEqual(all.slice(2));
    expect(next.masterBars[0]?.tempo).toEqual({ bpm: 120 });
  });

  it('is refused up front when the target is every bar', () => {
    const score = bars(3);
    const target = targetOf(ids(score));
    expect(target && deleteBlocker(score, target)).toBe('A score keeps at least one bar');
    expect(target && deleteBlocker(bars(4), target)).toBeUndefined();
  });
});

describe('the repeat toggles', () => {
  it('start goes on the first bar, end on the last, and both toggle back', () => {
    let score = bars(3);
    const target = targetOf(ids(score).slice(0, 2));
    if (!target) throw new Error('no target');
    score = applyCommand(score, planToggleRepeatStart(score, target) ?? ({} as never)).score;
    score = applyCommand(score, planToggleRepeatEnd(score, target) ?? ({} as never)).score;
    expect(score.masterBars.map(({ repeat }) => repeat)).toEqual([
      { start: true, endCount: 0 },
      { start: false, endCount: 2 },
      { start: false, endCount: 0 },
    ]);
    score = applyCommand(score, planToggleRepeatEnd(score, target) ?? ({} as never)).score;
    expect(score.masterBars[1]?.repeat.endCount).toBe(0);
  });
});

describe('barTarget', () => {
  it('is the cursor bar without a range, and nothing without a cursor', () => {
    const score = bars(2);
    expect(barTarget(score, { cursor: undefined, range: undefined })).toBeUndefined();
  });
});
