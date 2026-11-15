/**
 * Continuous segment breaks are stable (#147): an edit that changes a bar's width leaves the
 * later breaks where they were while their segments still fit, instead of moving every one of
 * them the way greedy filling would.
 */
import { applyCommand, setBeatDuration, setMasterBar, type Score } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, layout, type LayoutOptions } from './index';
import { layoutWith } from './layout';

const options: LayoutOptions = {
  mode: 'continuous',
  width: 640,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const startsOf = (result: ReturnType<typeof layout>): number[] =>
  result.systems.map(({ bars }) => bars.start);

/** Halves the first beat of `bar` to a sixteenth, which makes its bar wider (it is no longer full). */
const shorten = (score: Score, bar: number): { score: Score; touched: string[] } => {
  const applied = applyCommand(
    score,
    setBeatDuration({ beatId: beatOf(score, 0, bar, 0).id }, { duration: 16 }),
  );
  return { score: applied.score, touched: applied.change.touchedBars };
};

describe('stable continuous segment breaks', () => {
  const base = largeScore(2, 60, { structure: true });

  it('lays a fresh score out greedily, whatever a cache is passed', () => {
    const cold = layout(base, options);
    expect(startsOf(layout(base, options, new LayoutCache()))).toEqual(startsOf(cold));
    expect(startsOf(layoutWith(base, options, undefined, new Set()))).toEqual(startsOf(cold));
  });

  it('keeps every later break when an edit widens a bar, where greedy filling moves them', () => {
    const cache = new LayoutCache();
    const before = startsOf(layout(base, options, cache));
    const bar = Array.from({ length: base.masterBars.length }, (_, i) => i).find((i) => {
      const { score } = shorten(base, i);
      return startsOf(layout(score, options)).join() !== before.join();
    });
    // The premise: filling the line again takes more bars into the edited segment.
    if (bar === undefined) throw new Error('no edit moves a greedy break');
    const { score, touched } = shorten(base, bar);
    expect(startsOf(layout(score, { ...options, dirtyBars: touched }, cache))).toEqual(before);
  });

  it('re-breaks a segment that overflows past the tolerance, then keeps the new breaks', () => {
    const cache = new LayoutCache();
    const before = startsOf(layout(base, options, cache));
    const id = base.masterBars[before[2] ?? 0]?.id ?? '';
    // A bar of sixteen beats cannot share a line with its neighbours.
    const wide = applyCommand(
      base,
      setMasterBar({ masterBarId: id }, { timeSignature: { numerator: 16, denominator: 4 } }),
    );
    const broken = layout(wide.score, { ...options, dirtyBars: wide.change.touchedBars }, cache);
    const after = startsOf(broken);
    expect(after).not.toEqual(before);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));

    const last = wide.score.masterBars.length - 1;
    const { score, touched } = shorten(wide.score, last);
    expect(startsOf(layout(score, { ...options, dirtyBars: touched }, cache))).toEqual(after);
  });
});
