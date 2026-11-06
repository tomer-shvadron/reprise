import { applyCommand, setNote, type Score } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { expect, test } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { checkBudget, recordMeasurement } from './test/budget';

// tinybench: exactly 15 timed iterations after 3 untimed ones; one warm-up left writeGp cold.
const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };
// A real regression fails both attempts; a one-off noisy neighbour on a CI VM passes the retry.
const BENCH = { timeout: 120_000, retry: 1 };

const options: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const longScore = (): Score => largeScore(8, 300, { structure: true });

test('Full layout, cold', BENCH, async (context) => {
  // A fresh score each iteration: the tab module memoises its bar analysis per `Bar` object.
  let fresh = longScore();
  const result = await context
    .bench(
      'Full layout, cold',
      {
        beforeEach() {
          fresh = longScore();
        },
      },
      () => {
        layout(fresh, options);
      },
    )
    .run(RUN);
  await checkBudget(context, 'Full layout, cold', result.latency.p50, { enforced: true });
});

test('Re-layout after a single-note edit', BENCH, async (context) => {
  const cache = new LayoutCache();
  let score = longScore();
  layout(score, options, cache);
  let edit = 0;
  let dirtyBars: string[] = [];
  const measured: number[] = [];
  const result = await context
    .bench(
      'Re-layout after a single-note edit',
      {
        // A different bar each time, with a fret that differs from the current one, so every
        // iteration lays out exactly one changed bar against a warm cache.
        beforeEach() {
          const track = edit % 8;
          const bar = 100 + edit;
          edit += 1;
          const beat = beatOf(score, track, bar, 0);
          const fret = beat.notes.find((note) => note.string === 1)?.fret ?? -1;
          const next = applyCommand(
            score,
            setNote({ beatId: beat.id }, { string: 1, fret: (fret + 1) % 12 }),
          );
          score = next.score;
          dirtyBars = next.change.touchedBars;
        },
      },
      () => {
        measured.push(layout(score, { ...options, dirtyBars }, cache).metrics.measuredBars);
      },
    )
    .run(RUN);
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  expect(measured.slice(-RUN.iterations)).toEqual(Array.from({ length: RUN.iterations }, () => 1));
  await checkBudget(context, 'Re-layout after a single-note edit', result.latency.p50, {
    enforced: false,
    until: 'WP-027',
  });
});

test('Full layout, cold, standard notation', BENCH, async (context) => {
  const standard = (score: Score): LayoutOptions => ({
    ...options,
    notation: Object.fromEntries(score.tracks.map(({ id }) => [id, 'standard' as const])),
  });
  let fresh = longScore();
  let freshOptions = standard(fresh);
  const result = await context
    .bench(
      'Full layout, cold, standard notation',
      {
        beforeEach() {
          fresh = longScore();
          freshOptions = standard(fresh);
        },
      },
      () => {
        layout(fresh, freshOptions);
      },
    )
    .run(RUN);
  await recordMeasurement(context, 'Full layout, cold, standard notation', result.latency.p50);
});
