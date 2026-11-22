/**
 * `verticalReach` (#229): a continuous edit that changes the shared vertical layout redraws only
 * the segments nearest the edit; the rest keep their drawing until later calls catch them up, and
 * the converged result equals a cold layout from the same breaks.
 */
import { applyCommand, insertBar, setNoteEffect, type Notation, type Score } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, layout, type LayoutOptions, type LayoutResult } from './index';
import { layoutWith } from './layout';
import { stable } from './test/check-result';

const REACH = 4;

const base: LayoutOptions = {
  mode: 'continuous',
  width: 640,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

/** Track i shows tab, standard notation or both in turn: standard notation reads pitch extents. */
const MIXED: readonly Notation[] = ['tab', 'standard', 'both'];

const CASES: readonly [string, (score: Score) => LayoutOptions][] = [
  ['tab', () => base],
  [
    'mixed',
    (score) => ({
      ...base,
      notation: Object.fromEntries(
        score.tracks.map(({ id }, i) => [id, MIXED[i % MIXED.length] ?? 'tab']),
      ),
    }),
  ],
];

/** Lets the first note of bar `bar` ring, which adds a lane to its track's staff in every segment. */
function ring(score: Score, bar: number, letRing: boolean): { score: Score; touched: string[] } {
  const note = beatOf(score, 0, bar, 0).notes[0];
  if (!note) throw new Error(`bar ${String(bar)} has no note`);
  const applied = applyCommand(score, setNoteEffect({ noteId: note.id }, { letRing }));
  return { score: applied.score, touched: applied.change.touchedBars };
}

const breaksOf = (result: LayoutResult, score: Score): Set<string> =>
  new Set(result.systems.map(({ bars }) => score.masterBars[bars.start]?.id ?? ''));

const rendered = (result: LayoutResult): number =>
  result.systems.length - result.metrics.reusedSystems;

/** Calls with no dirty bars until nothing is stale; each call must make progress. */
function converge(score: Score, options: LayoutOptions, cache: LayoutCache): LayoutResult[] {
  const calls: LayoutResult[] = [];
  let stale = Infinity;
  for (;;) {
    const result = layout(score, options, cache);
    calls.push(result);
    if (result.metrics.staleSystems === 0) return calls;
    expect(result.metrics.staleSystems).toBeLessThan(stale);
    stale = result.metrics.staleSystems;
  }
}

describe.each(CASES)('verticalReach, continuous %s', (_name, build) => {
  const score = largeScore(4, 120, { structure: true });
  const options = { ...build(score), verticalReach: REACH };
  const bar = 60;

  const warm = () => {
    const cache = new LayoutCache();
    const first = layout(score, options, cache);
    return { cache, first };
  };

  const expectCold = (result: LayoutResult, at: Score, from: LayoutResult, prior: Score) => {
    const cold = layoutWith(
      at,
      { ...options, verticalReach: undefined },
      undefined,
      breaksOf(from, prior),
    );
    expect(stable(result)).toEqual(stable(cold));
  };

  it('redraws at most the reach plus the edited segments, nearest the edit, the rest stale', () => {
    const { cache, first } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    const after = layout(edited, { ...options, dirtyBars: touched }, cache);
    // The premise: the edit changed the shared vertical layout.
    expect(after.metrics.staleSystems).toBeGreaterThan(0);
    expect(rendered(after)).toBeLessThanOrEqual(REACH + 3);
    expect(after.metrics.staleSystems).toBe(after.systems.length - rendered(after));
    const edit = after.systems.findIndex((s) => s.bars.start <= bar && bar < s.bars.end);
    const redrawn = after.systems
      .map((_, i) => i)
      .filter(
        (i) =>
          after.primitives[after.systems[i]?.primitives.start ?? 0] !==
          first.primitives[first.systems[i]?.primitives.start ?? 0],
      );
    for (const i of redrawn) expect(Math.abs(i - edit)).toBeLessThanOrEqual(REACH + 1);
    // Stale segments are the previous result's own objects.
    const kept = after.systems.findIndex((_, i) => !redrawn.includes(i));
    const keptSystem = after.systems[kept];
    const was = first.systems[kept];
    expect(after.primitives[keptSystem?.primitives.start ?? 0]).toBe(
      first.primitives[was?.primitives.start ?? 0],
    );
  });

  it('converges to a cold layout in a bounded number of calls', () => {
    const { cache, first } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    const after = layout(edited, { ...options, dirtyBars: touched }, cache);
    const calls = converge(edited, options, cache);
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(first.systems.length / REACH));
    expectCold(calls.at(-1) ?? after, edited, first, score);
  });

  it('defers the shrinking half too, and converges to a cold layout of the original', () => {
    const { cache, first } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    layout(edited, { ...options, dirtyBars: touched }, cache);
    converge(edited, options, cache);
    const back = ring(edited, bar, false);
    const after = layout(back.score, { ...options, dirtyBars: back.touched }, cache);
    expect(after.metrics.staleSystems).toBeGreaterThan(0);
    const calls = converge(back.score, options, cache);
    expectCold(calls.at(-1) ?? after, back.score, first, edited);
  });

  it('converges after a second height-changing edit made while segments are stale', () => {
    const { cache, first } = warm();
    const one = ring(score, bar, true);
    layout(one.score, { ...options, dirtyBars: one.touched }, cache);
    const two = ring(one.score, 10, true);
    const mid = layout(two.score, { ...options, dirtyBars: two.touched }, cache);
    const calls = converge(two.score, options, cache);
    expectCold(calls.at(-1) ?? mid, two.score, first, score);
  });

  it('redraws every segment when the option is unset, as it always did', () => {
    const cache = new LayoutCache();
    layout(score, build(score), cache);
    const { score: edited, touched } = ring(score, bar, true);
    const after = layout(edited, { ...build(score), dirtyBars: touched }, cache);
    expect(after.metrics.staleSystems).toBe(0);
    expect(rendered(after)).toBeGreaterThan(REACH + 3);
  });

  it('redraws every stale segment in one call without the option, equal to cold', () => {
    const { cache, first } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    const deferred = layout(edited, { ...options, dirtyBars: touched }, cache);
    expect(deferred.metrics.staleSystems).toBeGreaterThan(0);
    const all = layout(edited, build(score), cache);
    expect(all.metrics.staleSystems).toBe(0);
    expectCold(all, edited, first, score);
  });

  it('converges to cold after a bar is inserted ahead of the stale segments', () => {
    const { cache } = warm();
    const one = ring(score, bar, true);
    layout(one.score, { ...options, dirtyBars: one.touched }, cache);
    const inserted = applyCommand(one.score, insertBar({ index: 3 }));
    const after = layout(
      inserted.score,
      { ...options, dirtyBars: inserted.change.touchedBars },
      cache,
    );
    // Segments after the insertion start at other bar indices, so they are redrawn anyway.
    const calls = converge(inserted.score, options, cache);
    const cold = layoutWith(
      inserted.score,
      { ...options, verticalReach: undefined },
      undefined,
      breaksOf(after, inserted.score),
    );
    expect(stable(calls.at(-1) ?? after)).toEqual(stable(cold));
  });

  it('catches stale segments up in a call with no dirty bars, past the unchanged ones', () => {
    const { cache } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    const first = layout(edited, { ...options, dirtyBars: touched }, cache);
    const follow = layout(edited, options, cache);
    expect(rendered(follow)).toBe(Math.min(REACH, first.metrics.staleSystems));
    expect(follow.metrics.staleSystems).toBe(first.metrics.staleSystems - rendered(follow));
  });

  it('also redraws every stale segment in verticalWindow, wherever it is, and converges to cold', () => {
    const { cache, first } = warm();
    const { score: edited, touched } = ring(score, bar, true);
    const at = first.systems.findIndex((s) => s.bars.start <= bar && bar < s.bars.end);
    const window = { start: at + 8, end: at + 12 };
    const after = layout(
      edited,
      { ...options, verticalReach: 1, verticalWindow: window, dirtyBars: touched },
      cache,
    );
    for (let i = window.start; i < window.end; i++) {
      const was = first.primitives[first.systems[i]?.primitives.start ?? 0];
      expect(after.primitives[after.systems[i]?.primitives.start ?? 0]).not.toBe(was);
    }
    // Segments between the edit and the window are still stale.
    expect(after.metrics.staleSystems).toBeGreaterThan(0);
    expect(rendered(after)).toBeLessThanOrEqual(1 + (window.end - window.start) + 3);
    const calls = converge(edited, { ...options, verticalReach: 1 }, cache);
    expectCold(calls.at(-1) ?? after, edited, first, score);
  });

  it('ignores the option without a cache', () => {
    const { score: edited } = ring(score, bar, true);
    const cold = layout(edited, { ...options, verticalReach: undefined });
    const result = layout(edited, options);
    expect(result.metrics.staleSystems).toBe(0);
    expect(stable(result)).toEqual(stable(cold));
  });

  it('rejects a reach that is not a non-negative integer', () => {
    expect(() => layout(score, { ...options, verticalReach: -1 })).toThrow(RangeError);
    expect(() => layout(score, { ...options, verticalReach: 1.5 })).toThrow(RangeError);
  });
});

describe('verticalReach, paged', () => {
  it('is ignored: no segment is stale and the result is the same', () => {
    const score = largeScore(2, 40, { structure: true });
    const paged: LayoutOptions = { ...base, mode: 'paged', width: 800 };
    const cache = new LayoutCache();
    layout(score, paged, cache);
    const { score: edited, touched } = ring(score, 20, true);
    const withReach = layout(edited, { ...paged, verticalReach: 1, dirtyBars: touched }, cache);
    const without = layout(edited, paged);
    expect(withReach.metrics.staleSystems).toBe(0);
    expect(stable(withReach)).toEqual(stable(without));
  });
});
