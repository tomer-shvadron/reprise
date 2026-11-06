import { applyCommand, setBeatDuration, setNote, type Notation, type Score } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { expect, test, type TestContext } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { checkBudget, recordMeasurement } from './test/budget';
import { withEffects } from './test/effects';

// tinybench: exactly 15 timed iterations after 3 untimed ones; #90's prototype found one too few.
const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };
// A real regression fails both attempts; a one-off noisy neighbour on a CI VM passes the retry.
const BENCH = { timeout: 120_000, retry: 1 };
const RELAYOUT_BENCH = { timeout: 300_000, retry: 1 };
/** The painter's `CONTINUOUS_SYSTEM_WIDTH`, which layout cannot import. */
const CONTINUOUS_WIDTH = 640;

const options: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const continuous: LayoutOptions = { ...options, mode: 'continuous', width: CONTINUOUS_WIDTH };

const longScore = (): Score => largeScore(8, 300, { structure: true });

const MIXED: readonly Notation[] = ['tab', 'standard', 'both'];

/** The roadmap's reference notation: track i shows `MIXED[i % 3]`. */
function mixedNotation(score: Score, base: LayoutOptions = options): LayoutOptions {
  return {
    ...base,
    notation: Object.fromEntries(
      score.tracks.map(({ id }, i) => [id, MIXED[i % MIXED.length] ?? 'tab']),
    ),
  };
}

function allNotation(score: Score, notation: Notation, base: LayoutOptions): LayoutOptions {
  return {
    ...base,
    notation: Object.fromEntries(score.tracks.map(({ id }) => [id, notation])),
  };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function coldBench(
  context: TestContext,
  name: string,
  setup: () => { score: Score; options: LayoutOptions },
): Promise<number> {
  // A fresh score each iteration: the modules memoise their bar analysis per `Bar` object.
  let fresh = setup();
  const result = await context
    .bench(name, { beforeEach: () => void (fresh = setup()) }, () => {
      layout(fresh.score, fresh.options);
    })
    .run(RUN);
  return result.latency.p50;
}

const coldTest = (
  metric: string,
  setup: () => { score: Score; options: LayoutOptions },
  enforced: boolean,
) => {
  test(metric, BENCH, async (context) => {
    const p50 = await coldBench(context, metric, setup);
    if (enforced) await checkBudget(context, metric, p50, { enforced: true });
    else await recordMeasurement(context, metric, p50);
  });
};

coldTest(
  'Full layout, cold',
  () => {
    const score = longScore();
    return { score, options: mixedNotation(score) };
  },
  true,
);

coldTest('Full layout, cold, tab notation', () => ({ score: longScore(), options }), false);

coldTest(
  'Full layout, cold, standard notation',
  () => {
    const score = longScore();
    return { score, options: allNotation(score, 'standard', options) };
  },
  false,
);

coldTest(
  'Full layout, cold, both notation',
  () => {
    const score = longScore();
    return { score, options: allNotation(score, 'both', options) };
  },
  false,
);

coldTest(
  'Full layout, cold, with note effects',
  () => ({ score: withEffects(longScore()), options }),
  false,
);

type Edit = (score: Score, edit: number) => ReturnType<typeof applyCommand>;

/** #95's pattern: a different bar each time, one string-1 fret that differs from the current one. */
const noteEdit: Edit = (score, edit) => {
  const beat = beatOf(score, edit % 8, 100 + edit, 0);
  const fret = beat.notes.find((note) => note.string === 1)?.fret ?? -1;
  return applyCommand(score, setNote({ beatId: beat.id }, { string: 1, fret: (fret + 1) % 12 }));
};

/**
 * Voice 1's first eighth halved to a sixteenth, which moves every later onset of the bar and so
 * its width (a beat inserted into the full bar would overfill it).
 */
const rhythmEdit: Edit = (score, edit) =>
  applyCommand(
    score,
    setBeatDuration({ beatId: beatOf(score, edit % 8, 100 + edit, 0).id }, { duration: 16 }),
  );

async function relayoutBench(
  context: TestContext,
  name: string,
  build: (score: Score) => LayoutOptions,
  edit: Edit,
): Promise<number> {
  const cache = new LayoutCache();
  let score = longScore();
  const caseOptions = build(score);
  layout(score, caseOptions, cache);
  let count = 0;
  let dirtyBars: string[] = [];
  const rendered: number[] = [];
  const result = await context
    .bench(
      name,
      {
        beforeEach() {
          const next = edit(score, count);
          count += 1;
          score = next.score;
          dirtyBars = next.change.touchedBars;
        },
      },
      () => {
        const { systems, metrics } = layout(score, { ...caseOptions, dirtyBars }, cache);
        rendered.push(systems.length - metrics.reusedSystems);
      },
    )
    .run(RUN);
  const p50 = result.latency.p50;
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  const systems = median(rendered.slice(-RUN.iterations));
  await context.annotate(
    `${name}: p50 ${String(Math.round(p50 * 10) / 10)} ms, median ${String(systems)} systems rendered`,
  );
  return p50;
}

const RELAYOUT_CASES: readonly [string, (score: Score) => LayoutOptions][] = [
  ['mixed, paged', (score) => mixedNotation(score)],
  ['mixed, continuous', (score) => mixedNotation(score, continuous)],
  ...(['tab', 'standard', 'both'] as const).flatMap(
    (notation): [string, (score: Score) => LayoutOptions][] => [
      [`${notation}, paged`, (score) => allNotation(score, notation, options)],
      [`${notation}, continuous`, (score) => allNotation(score, notation, continuous)],
    ],
  ),
];

test('Re-layout after a single-note edit', RELAYOUT_BENCH, async (context) => {
  const p50s: number[] = [];
  for (const [name, build] of RELAYOUT_CASES) {
    p50s.push(await relayoutBench(context, `Re-layout, ${name}`, build, noteEdit));
  }
  expect(p50s).toHaveLength(8);
  await checkBudget(context, 'Re-layout after a single-note edit', Math.max(...p50s), {
    enforced: true,
  });
});

test('Re-layout after a rhythm edit, continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout after a rhythm edit, continuous';
  const p50 = await relayoutBench(context, metric, () => continuous, rhythmEdit);
  await recordMeasurement(context, metric, p50);
});
