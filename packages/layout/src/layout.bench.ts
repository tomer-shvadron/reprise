import {
  applyCommand,
  setBeatDuration,
  setNote,
  setNoteEffect,
  type Dynamics,
  type Notation,
  type Score,
} from '@reprise/model';
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

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** More systems than an edit's own window renders: a sign it moved every later one. */
const MANY_SYSTEMS = 10;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function coldBench(
  context: TestContext,
  name: string,
  setup: () => { score: Score; options: LayoutOptions },
): Promise<number> {
  // A fresh score each iteration: the modules memoise their bar analysis per `Bar` object. The
  // fresh cache is what the app passes when it opens a document, and it costs the lane pass.
  let fresh = setup();
  let cache = new LayoutCache();
  const result = await context
    .bench(
      name,
      {
        beforeEach() {
          fresh = setup();
          cache = new LayoutCache();
        },
      },
      () => {
        layout(fresh.score, fresh.options, cache);
      },
    )
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
  const { p50, max } = result.latency;
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  const timed = rendered.slice(-RUN.iterations);
  const many = timed.filter((count) => count > MANY_SYSTEMS).length;
  await context.annotate(
    `${name}: p50 ${String(round(p50))} ms, max ${String(round(max))} ms, median ${String(median(timed))} systems rendered, ${String(many)} of ${String(timed.length)} edits rendered more than ${String(MANY_SYSTEMS)}`,
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

/**
 * The first dynamic in a system adds a lane, and once a page overflows every later page starts a
 * system later. The first edit adds a `pp` to one bar after another from bar 100 until one moves a
 * page break, judging each by cold layouts in an untimed warm-up; the rest restore that note's own
 * dynamic and set the `pp` again, alternately.
 */
function pageBreakEdit(build: (score: Score) => LayoutOptions): Edit {
  let target: { noteId: string; own: Dynamics } | undefined;
  let set = true;
  const pageStarts = (score: Score): string =>
    layout(score, build(score))
      .systems.filter((system, i, systems) => systems[i - 1]?.page !== system.page)
      .map((system) => system.bars.start)
      .join();
  const withDynamic = (score: Score, noteId: string, dynamics: Dynamics) =>
    applyCommand(score, setNoteEffect({ noteId }, { dynamics }));
  return (score) => {
    if (target) {
      set = !set;
      return withDynamic(score, target.noteId, set ? 'pp' : target.own);
    }
    let current = score;
    let before = pageStarts(current);
    for (let bar = 100; bar < current.masterBars.length; bar++) {
      const notes = current.tracks[0]?.bars[bar]?.voices[0]?.beats.flatMap((beat) => beat.notes);
      const note = notes?.find((candidate) => candidate.dynamics !== 'pp');
      if (!note) continue;
      const next = withDynamic(current, note.id, 'pp');
      const after = pageStarts(next.score);
      if (after !== before) {
        target = { noteId: note.id, own: note.dynamics };
        return next;
      }
      current = next.score;
      before = after;
    }
    throw new Error('no dynamic on the first track moves a page break');
  };
}

test('Re-layout after a page-break-moving edit, paged', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout after a page-break-moving edit, paged';
  // On the long score every system of all eight tracks fills a page, so one part is shown.
  const part = (score: Score): LayoutOptions => {
    const id = score.tracks[0]?.id ?? '';
    return { ...options, tracks: [id], notation: { [id]: 'tab' } };
  };
  const p50 = await relayoutBench(context, metric, part, pageBreakEdit(part));
  await recordMeasurement(context, metric, p50);
});
