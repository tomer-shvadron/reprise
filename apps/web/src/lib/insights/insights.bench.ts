import { expandPlaybackSequence, tempoMap, type Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { expect, inject, test, type TestContext } from 'vitest';

import { analyse } from './analyse';
import { extraction, noteTableOf } from './note-table';
import { songOutline } from './outline';

// tinybench: exactly 15 timed iterations after 3 untimed ones, as in the layout benches.
const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };
// The cold table is the noisiest row (the first iterations run before the JIT settles), so it takes
// more warm-ups and a longer run; the median is what the budget reads.
const COLD_RUN = { iterations: 31, time: 0, warmupIterations: 10, warmupTime: 0 };
const BENCH = { timeout: 120_000, retry: 1 };

/**
 * The bench side of the budgets table, for the first web bench file: the `web` project provides
 * the rows through `inject`, like `packages/layout/src/test/budget.ts`, which this app cannot import.
 */
interface ProvidedBudget {
  metric: string;
  value: number;
  unit: string;
  threshold: number;
  factor: number;
}

declare module 'vitest' {
  export interface ProvidedContext {
    budgets: ProvidedBudget[];
    budgetsError: string;
  }
  export interface TaskMeta {
    budget?: { metric: string; measured: number; enforced: boolean; note?: string };
  }
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

function budgetOf(metric: string): ProvidedBudget {
  const row = inject('budgets').find((budget) => budget.metric === metric);
  if (row) return row;
  throw new Error(`No row "${metric}" in the budgets table of docs/plans/roadmap.md`);
}

async function report(
  context: TestContext,
  metric: string,
  p50: number,
  budgeted: boolean,
  note?: string,
): Promise<void> {
  const measured = round(p50);
  context.task.meta.budget = { metric, measured, enforced: budgeted, ...(note ? { note } : {}) };
  if (!budgeted) {
    await context.annotate(`${metric}: p50 ${String(measured)} ms, no budget`);
    return;
  }
  const { threshold, value, factor } = budgetOf(metric);
  await context.annotate(
    `${metric}: p50 ${String(measured)} ms, ${String(threshold)} ms threshold (budget ${String(value)} ms ×${String(factor)})`,
  );
  expect(
    measured,
    `${metric}: p50 ${String(measured)} ms is over ${String(threshold)} ms`,
  ).toBeLessThanOrEqual(threshold);
}

const longScore = (): Score => largeScore(8, 300, { structure: true });

/** The tempo map playback builds once per score version; the app hands it to the outline. */
const mapOf = (score: Score) => tempoMap(score, expandPlaybackSequence(score).sequence);

/** The same score with every bar a new object, so no bar has cached rows: cold, without building 8 MB of score each time. */
const withFreshBars = (score: Score): Score => ({
  ...score,
  tracks: score.tracks.map((track) => ({ ...track, bars: track.bars.map((bar) => ({ ...bar })) })),
});

// A cold table is one the cache has never seen: every bar is a new object. The main thread pays
// this once per open, so it is one frame. Building a whole score for each iteration put garbage
// collection into the timing (about 22% noise on CI), so the bars are copied instead.
test('Song insights note table, long score, cold', BENCH, async (context) => {
  const base = longScore();
  let fresh = withFreshBars(base);
  const result = await context
    .bench(
      'Song insights note table, long score, cold',
      {
        beforeEach() {
          fresh = withFreshBars(base);
        },
      },
      () => {
        noteTableOf(fresh);
      },
    )
    .run(COLD_RUN);
  await report(context, 'Song insights note table, long score, cold', result.latency.p50, true);
});

// What an edit costs: one bar changes, so one bar is extracted again. Reported, not budgeted.
test('Song insights note table, one bar changed', BENCH, async (context) => {
  const score = longScore();
  noteTableOf(score);
  let edited = score;
  const extractedBefore = extraction.count;
  const result = await context
    .bench(
      'Song insights note table, one bar changed',
      {
        beforeEach() {
          const track = score.tracks[0];
          const bar = track?.bars[150];
          if (!track || !bar) throw new Error('no bar');
          const tracks = score.tracks.map((t) =>
            t === track ? { ...t, bars: t.bars.map((b) => (b === bar ? { ...b } : b)) } : t,
          );
          edited = { ...score, tracks };
        },
      },
      () => {
        noteTableOf(edited);
      },
    )
    .run(RUN);
  // One bar per iteration, warm-ups included: the table re-extracted the edited bar and nothing else.
  const extracted = extraction.count - extractedBefore;
  expect(extracted).toBeGreaterThanOrEqual(RUN.iterations);
  expect(extracted).toBeLessThanOrEqual(RUN.iterations + RUN.warmupIterations);
  await report(context, 'Song insights note table, one bar changed', result.latency.p50, false);
});

// The worker's job: everything after the table. The outline and the table are built outside the
// timing, as the main thread builds them before posting.
test('Song insights analysis, long score', BENCH, async (context) => {
  const score = longScore();
  const outline = songOutline(score, mapOf(score));
  const table = noteTableOf(
    score,
    outline.bars.map((bar) => bar.passes),
  );
  const result = await context
    .bench('Song insights analysis, long score', () => {
      analyse(table, outline);
    })
    .run(RUN);
  await report(context, 'Song insights analysis, long score', result.latency.p50, true);
});

// What the table avoids: a structured clone of the score, which posting it to a worker would cost.
test('Song insights score clone, long score', BENCH, async (context) => {
  const score = longScore();
  const result = await context
    .bench('Song insights score clone, long score', () => {
      structuredClone(score);
    })
    .run(RUN);
  await report(context, 'Song insights score clone, long score', result.latency.p50, false);
});
