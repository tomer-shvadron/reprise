import { applyCommand, setNote } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';

/** The roadmap's budget for a cold layout of the long score; WP-027 adds the re-layout budget. */
const COLD_BUDGET_MS = 250;
const RUNS = 5;

const options: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

describe('layout budget', () => {
  const long = largeScore(8, 300, { structure: true });

  it(`lays out the long score cold in under ${String(COLD_BUDGET_MS)} ms`, async ({ annotate }) => {
    const times = Array.from({ length: RUNS }, () => layout(long, options).metrics.layoutMs);
    const cold = median(times);
    await annotate(
      `cold layout of 8 tracks x 300 bars: median ${String(cold)} ms of ${times.join(', ')}`,
    );
    expect(cold).toBeLessThan(COLD_BUDGET_MS);
  });

  it(`lays out the long score in standard notation cold in under ${String(COLD_BUDGET_MS)} ms`, async ({
    annotate,
  }) => {
    // A fresh score each run, so the staff modules' per-bar memo starts empty.
    const scores = Array.from({ length: RUNS }, () => largeScore(8, 300, { structure: true }));
    const times = scores.map(
      (fresh) =>
        layout(fresh, {
          ...options,
          notation: Object.fromEntries(fresh.tracks.map(({ id }) => [id, 'standard' as const])),
        }).metrics.layoutMs,
    );
    const cold = median(times);
    await annotate(
      `cold standard-notation layout of 8 tracks x 300 bars: median ${String(cold)} ms of ${times.join(', ')}`,
    );
    expect(cold).toBeLessThan(COLD_BUDGET_MS);
  });

  it('re-lays out a single-note edit from the cache', async ({ annotate }) => {
    const cache = new LayoutCache();
    layout(long, options, cache);
    let current = long;
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const { score, change } = applyCommand(
        current,
        setNote({ beatId: beatOf(current, run % 8, 150, 0).id }, { string: 1, fret: run }),
      );
      current = score;
      const result = layout(score, { ...options, dirtyBars: change.touchedBars }, cache);
      expect(result.metrics.measuredBars).toBe(1);
      times.push(result.metrics.layoutMs);
    }
    await annotate(
      `re-layout after one note edit: median ${String(median(times))} ms of ${times.join(', ')}`,
    );
  });
});
