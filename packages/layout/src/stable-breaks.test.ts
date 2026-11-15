/**
 * Continuous segment breaks are stable (#147): an edit that changes a bar's width leaves the
 * later breaks where they were while their segments still fit, instead of moving every one of
 * them the way greedy filling would.
 */
import {
  applyCommand,
  insertBar,
  removeBar,
  setBeatDuration,
  setMasterBar,
  type Score,
} from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, layout, type LayoutOptions } from './index';
import { layoutWith } from './layout';

/** The keep rule's band in lines, written out so that changing `UNDERFLOW` or `OVERFLOW` fails here. */
const MIN_LINES = 0.5;
const MAX_LINES = 1.5;

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

  it('keeps a last segment under UNDERFLOW as it is', () => {
    const cache = new LayoutCache();
    const first = layout(base, options, cache);
    const tail = shape(base, first).at(-1);
    expect(tail?.lines).toBeLessThan(MIN_LINES);
    const { score, touched } = shorten(base, 20);
    const after = shape(score, layout(score, { ...options, dirtyBars: touched }, cache));
    expect(after.at(-1)?.id).toBe(tail?.id);
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

  /** The first bar of each segment, by id, and each segment's width in lines. */
  const shape = (score: Score, result: ReturnType<typeof layout>) =>
    result.systems.map(({ bars, bbox }) => ({
      id: score.masterBars[bars.start]?.id,
      bars: bars.end - bars.start,
      lines: bbox.width / options.width,
    }));

  /** Gives bar 5, in the middle of a three-bar segment, `beats` beats, and lays it out from `before`. */
  const withBeats = (beats: number) => {
    const cache = new LayoutCache();
    const before = layout(base, options, cache);
    const edited = applyCommand(
      base,
      setMasterBar(
        { masterBarId: base.masterBars[5]?.id ?? '' },
        { timeSignature: { numerator: beats, denominator: 4 } },
      ),
    );
    const after = layout(edited.score, { ...options, dirtyBars: edited.change.touchedBars }, cache);
    return {
      before,
      after,
      edited: edited.score,
      held: startsOf(after).join() === startsOf(before).join(),
    };
  };

  it('keeps a segment up to OVERFLOW lines and re-breaks it just past that', () => {
    let kept = 0;
    let width = 0;
    let step = 0;
    for (let beats = 4; beats <= 24; beats++) {
      const { after, held, edited } = withBeats(beats);
      if (!held) break;
      const segment = shape(edited, after).find(({ id }) => id === base.masterBars[5]?.id);
      step = beats > 4 ? (segment?.lines ?? 0) - width : 0;
      width = segment?.lines ?? 0;
      kept = beats;
    }
    expect(kept).toBeGreaterThan(4);
    expect(kept).toBeLessThan(24);
    // The widest kept width is within one more beat of the band's edge, the next beat is past it.
    expect(width).toBeLessThanOrEqual(MAX_LINES + 0.03);
    expect(width + step).toBeGreaterThan(MAX_LINES - 0.03);
  });

  it('re-breaks a segment that falls under UNDERFLOW and merges it with what follows', () => {
    const cache = new LayoutCache();
    const before = layout(base, options, cache);
    // Bars 6 and 7 go, leaving bar 5 alone in a segment of about a third of a line.
    let score = base;
    let touched: string[] = [];
    for (const index of [7, 6]) {
      const applied = applyCommand(
        score,
        removeBar({ masterBarId: score.masterBars[index]?.id ?? '' }),
      );
      score = applied.score;
      touched = [...touched, ...applied.change.touchedBars];
    }
    expect(
      shape(base, before).find(({ id }) => id === base.masterBars[5]?.id)?.lines,
    ).toBeGreaterThan(MIN_LINES);
    const after = shape(score, layout(score, { ...options, dirtyBars: touched }, cache));
    const sliver = after.find(({ id }) => id === score.masterBars[5]?.id);
    expect(sliver?.bars).toBeGreaterThan(1);
    expect(sliver?.lines).toBeGreaterThanOrEqual(MIN_LINES);
  });

  it('does not keep a lone bar that an undo leaves narrow', () => {
    const cache = new LayoutCache();
    layout(base, options, cache);
    const id = base.masterBars[5]?.id ?? '';
    const time = (numerator: number) =>
      setMasterBar({ masterBarId: id }, { timeSignature: { numerator, denominator: 4 } });
    const wide = applyCommand(base, time(16));
    layout(wide.score, { ...options, dirtyBars: wide.change.touchedBars }, cache);
    const back = applyCommand(wide.score, time(4));
    const after = shape(
      back.score,
      layout(back.score, { ...options, dirtyBars: back.change.touchedBars }, cache),
    );
    expect(after.find((segment) => segment.id === id)?.bars).toBeGreaterThan(1);
  });

  it('keeps a wide lone bar whole', () => {
    const cache = new LayoutCache();
    layout(base, options, cache);
    const id = base.masterBars[5]?.id ?? '';
    let score = base;
    // A bar wider than OVERFLOW lines, then wider still, so its segment is that one bar.
    for (const numerator of [28, 32]) {
      const applied = applyCommand(
        score,
        setMasterBar({ masterBarId: id }, { timeSignature: { numerator, denominator: 4 } }),
      );
      score = applied.score;
      const after = shape(
        score,
        layout(score, { ...options, dirtyBars: applied.change.touchedBars }, cache),
      );
      const lone = after.find((segment) => segment.id === id);
      expect(lone?.bars).toBe(1);
      expect(lone?.lines).toBeGreaterThan(MAX_LINES);
    }
  });

  it('keeps breaks by bar id when bars are inserted into and removed from segments', () => {
    const cache = new LayoutCache();
    const before = shape(base, layout(base, options, cache));
    const starts = startsOf(layout(base, options));
    // A bar goes into the segment holding bar 9, and one leaves the segment holding bar 15.
    const inserted = applyCommand(base, insertBar({ index: 9 }));
    const removed = applyCommand(
      inserted.score,
      removeBar({ masterBarId: inserted.score.masterBars[16]?.id ?? '' }),
    );
    const touched = [...inserted.change.touchedBars, ...removed.change.touchedBars];
    const result = layout(removed.score, { ...options, dirtyBars: touched }, cache);
    const after = shape(removed.score, result);
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(startsOf(result)[4]).toBe((starts[4] ?? 0) + 1);
    expect(startsOf(result).slice(-3)).toEqual(starts.slice(-3));
  });
});
