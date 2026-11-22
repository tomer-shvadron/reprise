import {
  applyCommand,
  chain,
  createNote,
  insertBeat,
  newId,
  removeBeat,
  setBeatDuration,
  setBeatDurations,
  setNote,
  setNoteEffect,
  type Dynamics,
  type Notation,
  type Score,
} from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { expect, test, type TestContext } from 'vitest';

import {
  LayoutCache,
  PAGE_SIZES,
  VERTICAL_EDIT_REACH,
  VERTICAL_FOLLOW_UP_REACH,
  anchorBox,
  hitTest,
  layout,
  type LayoutOptions,
} from './index';
import { checkBudget, recordMeasurement } from './test/budget';
import { withChordDiagrams, withEffects, withNoteMarks } from './test/effects';

// tinybench: exactly 15 timed iterations after 3 untimed ones; #90's prototype found one too few.
const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };
// A real regression fails both attempts; a one-off noisy neighbour on a CI VM passes the retry.
const BENCH = { timeout: 120_000, retry: 1 };
const RHYTHM_RUN = { ...RUN, iterations: 31 };
/** The fixed edit chain's split: a layout change that moves it changes what both rows average. */
const EDITS_OF_KIND = { keeps: 16, moves: 15 };
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

/**
 * More systems than an edit's own window renders: a sign it moved every later one. Counted in
 * parts, and a long-score system splits into at most two, so it is twice the plans a window holds.
 */
const MANY_SYSTEMS = 20;

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

coldTest(
  'Full layout, cold, chord diagrams',
  () => ({ score: withChordDiagrams(longScore()), options }),
  false,
);

coldTest(
  'Full layout, cold, with note marks, standard notation',
  () => {
    const score = withNoteMarks(withEffects(longScore()));
    return { score, options: allNotation(score, 'standard', options) };
  },
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

const isClock = (value: unknown): value is { now(): number } =>
  typeof value === 'object' && value !== null && 'now' in value && typeof value.now === 'function';

/** `performance` is in neither of the libs this package compiles with. */
const performanceClock: unknown = Reflect.get(globalThis, 'performance');
const now = (): number => {
  if (!isClock(performanceClock)) throw new Error('performance.now() is unavailable');
  return performanceClock.now();
};

const segmentStarts = (systems: readonly { bars: { start: number } }[]): string =>
  systems.map(({ bars }) => bars.start).join();

/**
 * Each edit's layout is timed alone, because an edit that keeps every segment break re-renders
 * three segments and one that would move a break re-renders more, so one p50 over the mix flips
 * between the two groups. Segment breaks are stable (#147): the cached layout keeps them where
 * they were while their segments fit, so an edit's kind is judged, untimed, by a cold layout of the
 * score before and after it, whose breaks are greedy, as the paged bench judges page breaks.
 */
async function rhythmBench(
  context: TestContext,
  name: string,
  kind: 'keeps' | 'moves',
): Promise<{ p50: number; note: string }> {
  const cache = new LayoutCache();
  let score = longScore();
  layout(score, continuous, cache);
  let starts = segmentStarts(layout(score, continuous).systems);
  let moved = false;
  let count = 0;
  let dirtyBars: string[] = [];
  const edits: { ms: number; moved: boolean; rendered: number }[] = [];
  await context
    .bench(
      `${name} (all edits, unsplit)`,
      {
        beforeEach() {
          const next = rhythmEdit(score, count);
          count += 1;
          score = next.score;
          dirtyBars = next.change.touchedBars;
          const after = segmentStarts(layout(score, continuous).systems);
          moved = after !== starts;
          starts = after;
        },
      },
      () => {
        const began = now();
        const { systems, metrics } = layout(score, { ...continuous, dirtyBars }, cache);
        const ms = now() - began;
        edits.push({ ms, moved, rendered: systems.length - metrics.reusedSystems });
      },
    )
    .run(RHYTHM_RUN);
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  const timed = edits.slice(-RHYTHM_RUN.iterations);
  const chosen = timed.filter(({ moved }) => moved === (kind === 'moves'));
  const mine = chosen.map(({ ms }) => ms);
  expect(
    mine.length,
    `${name}: ${String(mine.length)} edits ${kind === 'keeps' ? 'kept' : 'moved'} the segment breaks, expected ${String(EDITS_OF_KIND[kind])}`,
  ).toBe(EDITS_OF_KIND[kind]);
  const p50 = median(mine);
  // With the breaks stable an edit renders about three systems; a larger count is a re-break.
  const rendered = chosen.map((edit) => edit.rendered);
  await context.annotate(
    `${name}: p50 ${String(round(p50))} ms, max ${String(round(Math.max(...mine)))} ms over ${String(mine.length)} of ${String(timed.length)} edits, systems rendered median ${String(median(rendered))}, max ${String(Math.max(...rendered))}`,
  );
  return {
    p50,
    note: `${String(mine.length)} of ${String(timed.length)} edits ${kind === 'keeps' ? 'keep' : 'move'} a segment break`,
  };
}

test('Re-layout after a rhythm edit, continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout after a rhythm edit, continuous';
  const { p50, note } = await rhythmBench(context, metric, 'keeps');
  await checkBudget(context, metric, p50, { enforced: true, note });
});

test('Re-layout after a segment-break-moving edit, continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout after a segment-break-moving edit, continuous';
  const { p50, note } = await rhythmBench(context, metric, 'moves');
  await checkBudget(context, metric, p50, { enforced: true, note });
});

const EDIT_REACH = VERTICAL_EDIT_REACH;
const FOLLOW_UP_REACH = VERTICAL_FOLLOW_UP_REACH;

/**
 * Letting a note ring adds a lane to its track's staff in every segment, so it changes the shared
 * vertical layout: edit k adds one at bar `100 + k` of track `k % 8` and the odd edit after it
 * takes it away again, so timed edits alternate growing and shrinking.
 */
const heightEdit: Edit = (score, edit) => {
  const added = edit - (edit % 2);
  const track = score.tracks[added % 8];
  // The first note from bar `100 + added` on: the same one for the edit and the undo after it.
  for (let bar = 100 + added; bar < score.masterBars.length; bar++) {
    const note = track?.bars[bar]?.voices[0]?.beats.flatMap((beat) => beat.notes)[0];
    if (note) {
      return applyCommand(score, setNoteEffect({ noteId: note.id }, { letRing: edit % 2 === 0 }));
    }
  }
  throw new Error(`no note from bar ${String(100 + added)} of track ${String(added % 8)}`);
};

interface HeightRun {
  p50: number;
  max: number;
  rendered: number;
  /** Calls after the edit's own until nothing was stale. */
  followUps: number;
  converge: number;
  callP50: number;
  callMax: number;
  stale: number;
}

async function heightBench(
  context: TestContext,
  name: string,
  build: (score: Score) => LayoutOptions,
  verticalReach: number | undefined,
): Promise<HeightRun> {
  const cache = new LayoutCache();
  let score = longScore();
  const caseOptions = build(score);
  layout(score, caseOptions, cache);
  let count = 0;
  let dirtyBars: string[] = [];
  const edits: {
    ms: number;
    rendered: number;
    stale: number;
    followUps: number;
    ms2: number;
    calls: number[];
  }[] = [];
  let followUps = 0;
  let convergeMs = 0;
  let calls: number[] = [];
  await context
    .bench(
      name,
      {
        beforeEach() {
          // Untimed: the follow-up calls the app makes after an edit, until nothing is stale.
          followUps = 0;
          convergeMs = 0;
          calls = [];
          if (verticalReach !== undefined && count > 0) {
            for (;;) {
              const began = now();
              const { metrics } = layout(
                score,
                { ...caseOptions, verticalReach: FOLLOW_UP_REACH },
                cache,
              );
              const took = now() - began;
              convergeMs += took;
              calls.push(took);
              followUps += 1;
              if (metrics.staleSystems === 0) break;
            }
          }
          const next = heightEdit(score, count);
          count += 1;
          score = next.score;
          dirtyBars = next.change.touchedBars;
        },
      },
      () => {
        const began = now();
        const { systems, metrics } = layout(
          score,
          { ...caseOptions, dirtyBars, verticalReach },
          cache,
        );
        const ms = now() - began;
        edits.push({
          ms,
          rendered: systems.length - metrics.reusedSystems,
          stale: metrics.staleSystems,
          followUps,
          ms2: convergeMs,
          calls,
        });
      },
    )
    .run(RUN);
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  const timed = edits.slice(-RUN.iterations);
  const times = timed.map(({ ms }) => ms);
  const rendered = timed.map((edit) => edit.rendered);
  // The row must measure height-changing edits: with the reach, some segments were left stale and
  // at most the reach plus the edited three were redrawn; without it, nearly all were.
  for (const edit of timed) {
    if (verticalReach === undefined) expect(edit.rendered).toBeGreaterThan(EDIT_REACH + 3);
    else {
      expect(edit.stale, `${name}: an edit left nothing stale`).toBeGreaterThan(0);
      expect(edit.rendered).toBeLessThanOrEqual(verticalReach + 3);
    }
  }
  const p50 = median(times);
  const max = Math.max(...times);
  const stale = median(timed.map((edit) => edit.stale));
  const follow = median(timed.map((edit) => edit.followUps));
  const converge = median(timed.map((edit) => edit.ms2));
  const callTimes = timed.flatMap((edit) => edit.calls);
  await context.annotate(
    `${name}: p50 ${String(round(p50))} ms, max ${String(round(max))} ms, median ${String(median(rendered))} segments rendered, ${String(stale)} left stale, ${String(follow)} follow-up calls${verticalReach === undefined ? '' : ` (reach ${String(FOLLOW_UP_REACH)})`} and ${String(round(converge))} ms to converge per edit${callTimes.length > 0 ? `, one follow-up call p50 ${String(round(median(callTimes)))} ms, max ${String(round(Math.max(...callTimes)))} ms` : ''}`,
  );
  return {
    p50,
    max,
    rendered: median(rendered),
    followUps: follow,
    converge,
    stale,
    callP50: callTimes.length > 0 ? median(callTimes) : 0,
    callMax: callTimes.length > 0 ? Math.max(...callTimes) : 0,
  };
}

const HEIGHT_CASES: readonly [string, (score: Score) => LayoutOptions][] = [
  ['tab', (score) => allNotation(score, 'tab', continuous)],
  ['mixed', (score) => mixedNotation(score, continuous)],
];

test('Re-layout after a height-changing edit, continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout after a height-changing edit, continuous';
  const runs: HeightRun[] = [];
  for (const [name, build] of HEIGHT_CASES) {
    runs.push(await heightBench(context, `${metric}, ${name}`, build, EDIT_REACH));
  }
  const slowest = Math.max(...runs.map(({ p50 }) => p50));
  await checkBudget(context, metric, slowest, {
    enforced: true,
    note: `reach ${String(EDIT_REACH)}; converges in ${String(Math.max(...runs.map(({ followUps }) => followUps)))} follow-up calls of reach ${String(FOLLOW_UP_REACH)}`,
  });
});

/**
 * One follow-up call as the app makes them after a height-changing edit: a full cached `layout()`
 * (measure check, lanes, the shared vertical layout over every bar, breaking) that redraws the
 * next `VERTICAL_FOLLOW_UP_REACH` stale segments, run from a timer on the main thread. It is what
 * a scroll during convergence waits behind, so it is budgeted like an edit.
 */
test('Re-layout follow-up call, continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Re-layout follow-up call, continuous';
  const runs: HeightRun[] = [];
  for (const [name, build] of HEIGHT_CASES) {
    runs.push(await heightBench(context, `${metric}, ${name}`, build, EDIT_REACH));
  }
  await checkBudget(context, metric, Math.max(...runs.map(({ callP50 }) => callP50)), {
    enforced: true,
    note: `reach ${String(FOLLOW_UP_REACH)}, max ${String(round(Math.max(...runs.map(({ callMax }) => callMax))))} ms`,
  });
});

test(
  'Re-layout after a height-changing edit, continuous, undeferred',
  RELAYOUT_BENCH,
  async (context) => {
    const metric = 'Re-layout after a height-changing edit, continuous, undeferred';
    const runs: HeightRun[] = [];
    for (const [name, build] of HEIGHT_CASES) {
      runs.push(await heightBench(context, `${metric}, ${name}`, build, undefined));
    }
    // What the edit cost before `verticalReach`: kept so the trade stays visible.
    await recordMeasurement(context, metric, Math.max(...runs.map(({ p50 }) => p50)));
  },
);

/**
 * One note-entry keystroke as the editor sends it (`entry.ts`): a composed `enterNote` holding one
 * `insertBeat` that carries the beat's own id and its note, through `applyCommand`, then the
 * cached continuous re-layout of the bar it touched. Each edit first takes the last beat out of a
 * different bar, untimed, so the entry has room. The apply side is the model's validation, which
 * looks only at the bars an edit touched (#240); the annotation splits it from layout.
 */
test('Note entry keystroke (apply + re-layout), continuous', RELAYOUT_BENCH, async (context) => {
  const metric = 'Note entry keystroke (apply + re-layout), continuous';
  const cache = new LayoutCache();
  let score = longScore();
  layout(score, continuous, cache);
  let count = 0;
  let pending: ReturnType<typeof chain> | undefined;
  const timings: { apply: number; layout: number }[] = [];
  const result = await context
    .bench(
      metric,
      {
        beforeEach() {
          const track = count % 8;
          const bar = 100 + count;
          count += 1;
          const voice = score.tracks[track]?.bars[bar]?.voices[0];
          const last = voice?.beats.at(-1);
          if (!voice || !last) throw new Error(`no beat to make room in bar ${String(bar)}`);
          score = applyCommand(score, removeBeat({ beatId: last.id })).score;
          pending = chain('enterNote', [
            insertBeat(
              { voiceId: voice.id, index: voice.beats.length - 1, id: newId() },
              {
                duration: last.duration,
                dots: last.dots,
                notes: [createNote({ string: 1, fret: 5 })],
              },
            ),
          ]);
        },
      },
      () => {
        if (!pending) return;
        const began = now();
        const applied = applyCommand(score, pending);
        const applyDone = now();
        score = applied.score;
        layout(score, { ...continuous, dirtyBars: applied.change.touchedBars }, cache);
        timings.push({ apply: applyDone - began, layout: now() - applyDone });
      },
    )
    .run(RUN);
  // tinybench calls the function once before any beforeEach, to see whether it is async.
  const timed = timings.slice(-RUN.iterations);
  await context.annotate(
    `${metric}: apply p50 ${String(round(median(timed.map((t) => t.apply))))} ms, re-layout p50 ${String(round(median(timed.map((t) => t.layout))))} ms, max total ${String(round(result.latency.max))} ms`,
  );
  await checkBudget(context, metric, result.latency.p50, { enforced: true });
});

/**
 * A rhythm key over a two-bar range, as the editor sends it: every eighth of two bars of one
 * track halved through one `setRhythm` chain, then the cached continuous re-layout of the bars it
 * touched. Each edit takes two bars further along, on the next track, so none is edited twice.
 */
test(
  'Rhythm key over a two-bar range (apply + re-layout), continuous',
  RELAYOUT_BENCH,
  async (context) => {
    const metric = 'Rhythm key over a two-bar range (apply + re-layout), continuous';
    const cache = new LayoutCache();
    let score = longScore();
    layout(score, continuous, cache);
    let count = 0;
    let pending: ReturnType<typeof chain> | undefined;
    const timings: { apply: number; layout: number }[] = [];
    const result = await context
      .bench(
        metric,
        {
          beforeEach() {
            const track = score.tracks[count % 8];
            const bars = [100 + 2 * count, 101 + 2 * count];
            count += 1;
            const beats = bars.flatMap((b) => track?.bars[b]?.voices[0]?.beats ?? []);
            if (beats.length === 0) throw new Error('no beats in the range');
            pending = chain('setRhythm', [
              setBeatDurations(beats.map(({ id }) => ({ beatId: id, rhythm: { duration: 16 } }))),
            ]);
          },
        },
        () => {
          if (!pending) return;
          const began = now();
          const applied = applyCommand(score, pending);
          const applyDone = now();
          score = applied.score;
          layout(score, { ...continuous, dirtyBars: applied.change.touchedBars }, cache);
          timings.push({ apply: applyDone - began, layout: now() - applyDone });
        },
      )
      .run(RUN);
    const timed = timings.slice(-RUN.iterations);
    await context.annotate(
      `${metric}: apply p50 ${String(round(median(timed.map((t) => t.apply))))} ms, re-layout p50 ${String(round(median(timed.map((t) => t.layout))))} ms, max total ${String(round(result.latency.max))} ms`,
    );
    await checkBudget(context, metric, result.latency.p50, { enforced: true });
  },
);

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

/**
 * The pointer's cost: one `hitTest` per move, 1 000 per run. Half the points are the centres of
 * 500 note anchors spread evenly over the score (a hit), half pseudo-random (mostly gaps and
 * margins), the same on every run.
 */
async function hitTestBench(
  context: TestContext,
  name: string,
  base: LayoutOptions,
): Promise<number> {
  const score = longScore();
  const laid = layout(score, mixedNotation(score, base));
  // 500 note centres, spread evenly over every note anchor, then random points up to 1 000.
  const noteAnchors = laid.anchors.filter((anchor) => anchor.kind === 'note');
  const points: [number, number][] = [];
  for (let i = 0; i < 500; i++) {
    const anchor = noteAnchors[Math.floor((i * noteAnchors.length) / 500)];
    if (!anchor) continue;
    const box = anchorBox(laid, anchor);
    points.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  const last = laid.systems.at(-1);
  if (!last) throw new Error('no systems');
  let seed = 12_345;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const right = Math.max(...laid.systems.map((s) => s.bbox.x + s.bbox.width));
  const bottom = last.bbox.y + last.bbox.height;
  while (points.length < 1000) points.push([random() * right, random() * bottom]);
  let hits = 0;
  const result = await context
    .bench(name, () => {
      for (const [x, y] of points) if (hitTest(laid, x, y)) hits++;
    })
    .run(RUN);
  expect(hits).toBeGreaterThan(0);
  return result.latency.p50;
}

// One row for the pointer, against the slower of the two modes: continuous, which shifts boxes.
test('Hit test, 1 000 points, long score', BENCH, async (context) => {
  const metric = 'Hit test, 1 000 points, long score';
  const paged = await hitTestBench(context, `${metric}, paged`, options);
  const flowing = await hitTestBench(context, `${metric}, continuous`, continuous);
  await checkBudget(context, metric, Math.max(paged, flowing), {
    enforced: true,
    note: `paged ${String(round(paged))} ms, continuous ${String(round(flowing))} ms`,
  });
});
