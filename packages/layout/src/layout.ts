import type { Id, Score } from '@reprise/model';

import { breakSystems, type SystemPlan } from './breaking';
import {
  readCache,
  sameInputs,
  writeCache,
  type CachedBar,
  type CachedSystem,
  type Cursor,
  type LayoutCache,
} from './cache';
import { barContexts, type BarContext } from './context';
import { measureBar, type BarMeasure } from './measure';
import { resolveOptions, type ResolvedOptions } from './options';
import { rect, round, type LayoutSink } from './primitives';
import { renderSystem } from './render';
import {
  enteringDynamics,
  isClean,
  reposition,
  sameCursor,
  samePlan,
  type ChangedBars,
} from './reuse';
import { staffBar, staffSlots, trackBar, type StaffSlot } from './slots';
import { LANE_HEIGHT, mergeLanes, type LaneRequests } from './staves/lanes';
import { BAR_REACH } from './staves/staff-module';
import type { Anchor, LayoutOptions, LayoutResult, Page, Primitive, Range, System } from './types';
import { verticalLayout, type VerticalLayout } from './vertical';

interface Clock {
  now(): number;
}

function isClock(value: unknown): value is Clock {
  return (
    typeof value === 'object' && value !== null && 'now' in value && typeof value.now === 'function'
  );
}

/** `performance` is in every runtime layout targets but in neither of the libs it compiles with. */
const performanceClock: unknown = Reflect.get(globalThis, 'performance');
const clock: Clock = isClock(performanceClock) ? performanceClock : Date;

function barInputs(score: Score, context: BarContext, options: ResolvedOptions): unknown[] {
  const { index, masterBar } = context;
  const tracks = masterBar.anacrusis ? score.tracks : options.tracks.map(({ track }) => track);
  // A five-line staff's bar reads the bar before it (courtesy accidentals, ties, dynamics) and
  // the key it cancels (naturals, courtesies).
  const before = options.tracks.filter(({ staves }) => staves.some((type) => type !== 'tab'));
  return [
    masterBar,
    score.masterBars[index - 1]?.keySignature,
    ...tracks.map((track) => track.bars[index]),
    ...before.map(({ track }) => track.bars[index - 1]),
    ...context.clefs,
    ...context.clefChanges,
    context.showTime,
    context.keyChange,
    context.isLast,
  ];
}

interface Measured {
  measures: BarMeasure[];
  bars: Map<Id, CachedBar>;
  measured: number;
  changed: ChangedBars;
  /** Index of the last bar re-measured in this call; -1 when none was. */
  lastChanged: number;
}

function measureAll(
  score: Score,
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  previous: ReadonlyMap<Id, CachedBar> | undefined,
  dirty: ReadonlySet<Id>,
): Measured {
  const bars = new Map<Id, CachedBar>();
  const measures: BarMeasure[] = [];
  const changed: ChangedBars = new Int32Array(contexts.length + 1);
  let measured = 0;
  let lastChanged = -1;
  for (const context of contexts) {
    const { id } = context.masterBar;
    const inputs = barInputs(score, context, options);
    const cached = previous?.get(id);
    changed[context.index] = measured;
    let entry: CachedBar;
    if (cached && !dirty.has(id) && sameInputs(cached.inputs, inputs)) {
      entry = cached;
    } else {
      entry = { inputs, measure: measureBar(score, context, slots, options.space) };
      measured += 1;
      lastChanged = context.index;
    }
    bars.set(id, entry);
    measures.push(entry.measure);
  }
  changed[contexts.length] = measured;
  return { measures, bars, measured, changed, lastChanged };
}

function barIds(score: Score, plan: SystemPlan): (Id | undefined)[] {
  const ids: (Id | undefined)[] = [];
  for (let i = plan.start; i <= plan.end; i++) ids.push(score.masterBars[i]?.id);
  return ids;
}

/**
 * Per staff slot, the lanes bars `start` to `end` (exclusive) draw into, each at its tallest
 * request. Never cached: a bar's lanes may depend on earlier bars (a dynamic shows only where it
 * changes), and only the systems being built ask.
 */
function laneRequests(
  score: Score,
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  start: number,
  end: number,
): LaneRequests[] {
  const requests = slots.map((): LaneRequests => ({}));
  for (let index = start; index < end; index++) {
    const context = contexts[index];
    if (!context) continue;
    for (const [i, slot] of slots.entries()) {
      const bar = trackBar(slot, index);
      const into = requests[i];
      if (!bar || !into) continue;
      mergeLanes(into, slot.module.lanes(staffBar(score, slot, bar, context, options.space)));
    }
    const first = requests[0];
    if (first && context.masterBar.repeat.endCount > 2) {
      mergeLanes(first, { repeatCount: LANE_HEIGHT.repeatCount * options.space });
    }
  }
  return requests;
}

function pageTop(options: ResolvedOptions, page: number): number {
  return page * (options.pageHeight + options.pageGap);
}

function place(options: ResolvedOptions, cursor: Cursor, height: number): Cursor {
  if (options.mode === 'continuous') return cursor;
  const limit = pageTop(options, cursor.page) + options.pageHeight - options.margins.bottom;
  if (cursor.empty || cursor.y + height <= limit) return cursor;
  const page = cursor.page + 1;
  return {
    page,
    x: options.margins.left,
    y: pageTop(options, page) + options.margins.top,
    empty: true,
  };
}

function advance(options: ResolvedOptions, cursor: Cursor, system: System): Cursor {
  if (options.mode === 'continuous') {
    return { ...cursor, x: system.bbox.x + system.bbox.width, empty: false };
  }
  return { ...cursor, y: system.bbox.y + system.bbox.height + options.systemGap, empty: false };
}

function pages(options: ResolvedOptions, systems: readonly System[]): Page[] {
  const { margins } = options;
  if (options.mode === 'continuous') {
    let right = options.width;
    let bottom = 0;
    for (const { bbox } of systems) {
      right = Math.max(right, bbox.x + bbox.width + margins.right);
      bottom = Math.max(bottom, bbox.y + bbox.height + margins.bottom);
    }
    return [
      { index: 0, bbox: rect(0, 0, right, bottom), systems: { start: 0, end: systems.length } },
    ];
  }
  const ranges: Range[] = [{ start: 0, end: 0 }];
  for (const system of systems) {
    while (ranges.length <= system.page) ranges.push({ start: system.index, end: system.index });
    const range = ranges[system.page];
    if (range) range.end = system.index + 1;
  }
  return ranges.map((systemRange, index) => ({
    index,
    bbox: rect(0, pageTop(options, index), options.width, options.pageHeight),
    systems: systemRange,
  }));
}

/**
 * Lays out `score` for `options`. With a cache from an earlier call on the same document, bars
 * whose content is unchanged (by identity) and not listed in `options.dirtyBars` keep their
 * measurements, and every system more than `BAR_REACH` bars from a re-measured bar is reused
 * where it breaks, sits and enters with the same dynamics as before.
 */
export function layout(score: Score, options: LayoutOptions, cache?: LayoutCache): LayoutResult {
  const started = clock.now();
  const resolved = resolveOptions(score, options);
  const slots = staffSlots(resolved);
  const contexts = barContexts(score, resolved.tracks);

  let state = cache ? readCache(cache) : undefined;
  if (state && state.measureKey !== resolved.measureKey) state = undefined;
  const { measures, bars, measured, changed, lastChanged } = measureAll(
    score,
    contexts,
    slots,
    resolved,
    state?.bars,
    new Set(options.dirtyBars ?? []),
  );

  const global: VerticalLayout | undefined =
    resolved.mode === 'continuous'
      ? verticalLayout(
          score.masterBars,
          measures,
          slots,
          resolved,
          laneRequests(score, contexts, slots, resolved, 0, contexts.length),
        )
      : undefined;

  const previous = state && state.systemKey === resolved.systemKey ? state.systems : [];
  const sameBarCount = state?.barCount === score.masterBars.length;
  const systems: CachedSystem[] = [];
  let reused = 0;
  let primitiveCount = 0;
  let anchorCount = 0;
  const keep = (entry: CachedSystem): void => {
    const primitives = { start: primitiveCount, end: primitiveCount + entry.primitives.length };
    const anchors = { start: anchorCount, end: anchorCount + entry.anchors.length };
    systems.push(reposition(entry, systems.length, primitives, anchors));
    primitiveCount = primitives.end;
    anchorCount = anchors.end;
    reused += 1;
  };
  const unchanged = (old: CachedSystem, plan: SystemPlan): boolean =>
    isClean(changed, plan.start, plan.end) &&
    sameInputs(barIds(score, plan), old.barIds) &&
    (global === undefined || old.verticalKey === global.key);

  // Systems before the first change stay as they were, objects and all.
  let next = 0;
  for (const old of previous) {
    if (!unchanged(old, old.plan)) break;
    keep(old);
    next += 1;
  }

  if (slots.length > 0) {
    const last = systems.at(-1);
    let cursor: Cursor = last
      ? advance(resolved, last.at, last.system)
      : { page: 0, x: resolved.margins.left, y: resolved.margins.top, empty: true };
    const byStart = new Map<number, number>();
    for (let i = next; i < previous.length; i++) {
      const old = previous[i];
      if (old) byStart.set(old.plan.start, i);
    }
    for (const plan of breakSystems(measures, contexts, slots, resolved, last?.plan.end ?? 0)) {
      const position = byStart.get(plan.start);
      const old = position === undefined ? undefined : previous[position];
      if (old && position !== undefined && samePlan(old.plan, plan) && unchanged(old, plan)) {
        const at = place(resolved, cursor, old.height);
        if (
          sameCursor(at, old.at) &&
          enteringDynamics(resolved.tracks, plan.start) === old.entering
        ) {
          keep(old);
          cursor = advance(resolved, at, old.system);
          // Past the last change by more than any module reads, the breaks, placements and
          // entering dynamics all follow from this system's, so the rest is as it was.
          if (sameBarCount && plan.start - BAR_REACH > lastChanged) {
            for (const later of previous.slice(position + 1)) keep(later);
            break;
          }
          continue;
        }
      }

      const vertical =
        global ??
        verticalLayout(
          score.masterBars.slice(plan.start, plan.end),
          measures.slice(plan.start, plan.end),
          slots,
          resolved,
          laneRequests(score, contexts, slots, resolved, plan.start, plan.end),
        );
      const at = place(resolved, cursor, vertical.height);
      const index = systems.length;
      const id = `system:${score.masterBars[plan.start]?.id ?? String(index)}`;
      const sink: LayoutSink = { primitives: [], anchors: [] };
      const rendered = renderSystem(
        {
          score,
          contexts,
          measures,
          slots,
          options: resolved,
          plan,
          vertical,
          x: at.x,
          y: at.y,
          index,
          id,
        },
        sink,
      );
      const system: System = {
        id,
        index,
        page: at.page,
        bars: { start: plan.start, end: plan.end },
        bbox: rendered.bbox,
        staves: rendered.staves,
        primitives: { start: primitiveCount, end: primitiveCount + sink.primitives.length },
        anchors: { start: anchorCount, end: anchorCount + sink.anchors.length },
      };
      primitiveCount += sink.primitives.length;
      anchorCount += sink.anchors.length;
      systems.push({
        plan,
        barIds: barIds(score, plan),
        verticalKey: vertical.key,
        at,
        height: vertical.height,
        entering: cache ? enteringDynamics(resolved.tracks, plan.start) : '',
        system,
        primitives: sink.primitives,
        anchors: sink.anchors,
      });
      cursor = advance(resolved, at, system);
    }
  }
  const systemList = systems.map(({ system }) => system);
  // One copy per array: pushing item by item cost several times as much on the long score.
  const noPrimitives: Primitive[] = [];
  const noAnchors: Anchor[] = [];
  const primitives = noPrimitives.concat(...systems.map((entry) => entry.primitives));
  const anchors = noAnchors.concat(...systems.map((entry) => entry.anchors));

  if (cache) {
    writeCache(cache, {
      measureKey: resolved.measureKey,
      systemKey: resolved.systemKey,
      bars,
      barCount: score.masterBars.length,
      systems,
    });
  }

  return {
    pages: pages(resolved, systemList),
    systems: systemList,
    primitives,
    anchors,
    metrics: {
      layoutMs: round(clock.now() - started),
      primitives: primitives.length,
      anchors: anchors.length,
      measuredBars: measured,
      reusedSystems: reused,
    },
  };
}
