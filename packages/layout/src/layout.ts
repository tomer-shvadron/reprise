import type { Id, Score } from '@reprise/model';

import { breakSystems, type SystemPlan } from './breaking';
import {
  readCache,
  sameInputs,
  writeCache,
  type CachedBar,
  type CachedSystem,
  type LayoutCache,
} from './cache';
import { barContexts, type BarContext } from './context';
import { measureBar, type BarMeasure } from './measure';
import { resolveOptions, type ResolvedOptions } from './options';
import { rect, round, type LayoutSink } from './primitives';
import { renderSystem } from './render';
import { staffSlots, type StaffSlot } from './slots';
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
  // A five-line staff's bar reads the bar before it: courtesy accidentals, ties, dynamics.
  const before = options.tracks.filter(({ staves }) => staves.some((type) => type !== 'tab'));
  return [
    masterBar,
    ...tracks.map((track) => track.bars[index]),
    ...before.map(({ track }) => track.bars[index - 1]),
    ...context.clefs,
    ...context.clefChanges,
    context.showTime,
    context.keyChange,
    context.isLast,
  ];
}

function measureAll(
  score: Score,
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  previous: ReadonlyMap<Id, CachedBar> | undefined,
  dirty: ReadonlySet<Id>,
): { measures: BarMeasure[]; bars: Map<Id, CachedBar>; measured: number; firstDirty: number } {
  const bars = new Map<Id, CachedBar>();
  const measures: BarMeasure[] = [];
  let measured = 0;
  let firstDirty = Infinity;
  for (const context of contexts) {
    const { id } = context.masterBar;
    const inputs = barInputs(score, context, options);
    const cached = previous?.get(id);
    let entry: CachedBar;
    if (cached && !dirty.has(id) && sameInputs(cached.inputs, inputs)) {
      entry = cached;
    } else {
      entry = { inputs, measure: measureBar(score, context, slots, options.space) };
      measured += 1;
      firstDirty = Math.min(firstDirty, context.index);
    }
    bars.set(id, entry);
    measures.push(entry.measure);
  }
  return { measures, bars, measured, firstDirty };
}

function barIds(score: Score, plan: SystemPlan): (Id | undefined)[] {
  const ids: (Id | undefined)[] = [];
  for (let i = plan.start; i <= plan.end; i++) ids.push(score.masterBars[i]?.id);
  return ids;
}

function stillValid(
  score: Score,
  system: CachedSystem,
  firstDirty: number,
  verticalKey: string | undefined,
): boolean {
  if (system.plan.end >= firstDirty) return false;
  if (verticalKey !== undefined && system.verticalKey !== verticalKey) return false;
  const ids = barIds(score, system.plan);
  return sameInputs(ids, system.barIds);
}

/** Where the next system goes: paged systems flow down pages, continuous ones run rightwards. */
interface Cursor {
  page: number;
  x: number;
  y: number;
  empty: boolean;
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

function append<T>(target: T[], items: readonly T[]): Range {
  const start = target.length;
  for (const item of items) target.push(item);
  return { start, end: target.length };
}

/**
 * Lays out `score` for `options`. With a cache from an earlier call on the same document, bars
 * whose content is unchanged (by identity) and not listed in `options.dirtyBars` keep their
 * measurements, and systems before the first re-measured bar are reused as they were.
 */
export function layout(score: Score, options: LayoutOptions, cache?: LayoutCache): LayoutResult {
  const started = clock.now();
  const resolved = resolveOptions(score, options);
  const slots = staffSlots(resolved);
  const contexts = barContexts(score, resolved.tracks);

  let state = cache ? readCache(cache) : undefined;
  if (state && state.measureKey !== resolved.measureKey) state = undefined;
  const { measures, bars, measured, firstDirty } = measureAll(
    score,
    contexts,
    slots,
    resolved,
    state?.bars,
    new Set(options.dirtyBars ?? []),
  );

  const global: VerticalLayout | undefined =
    resolved.mode === 'continuous'
      ? verticalLayout(score.masterBars, measures, slots, resolved)
      : undefined;

  const kept: CachedSystem[] = [];
  if (state && state.systemKey === resolved.systemKey) {
    for (const system of state.systems) {
      if (!stillValid(score, system, firstDirty, global?.key)) break;
      kept.push(system);
    }
  }

  const systems: CachedSystem[] = [];
  const primitives: Primitive[] = [];
  const anchors: Anchor[] = [];
  for (const entry of kept) {
    systems.push(entry);
    append(primitives, entry.primitives);
    append(anchors, entry.anchors);
  }

  if (slots.length > 0) {
    const last = kept.at(-1);
    let cursor: Cursor = last
      ? advance(
          resolved,
          { page: last.system.page, x: resolved.margins.left, y: last.system.bbox.y, empty: false },
          last.system,
        )
      : { page: 0, x: resolved.margins.left, y: resolved.margins.top, empty: true };
    for (const plan of breakSystems(measures, contexts, slots, resolved, last?.plan.end ?? 0)) {
      const vertical =
        global ??
        verticalLayout(
          score.masterBars.slice(plan.start, plan.end),
          measures.slice(plan.start, plan.end),
          slots,
          resolved,
        );
      cursor = place(resolved, cursor, vertical.height);
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
          x: cursor.x,
          y: cursor.y,
          index,
          id,
        },
        sink,
      );
      const system: System = {
        id,
        index,
        page: cursor.page,
        bars: { start: plan.start, end: plan.end },
        bbox: rendered.bbox,
        staves: rendered.staves,
        primitives: append(primitives, sink.primitives),
        anchors: append(anchors, sink.anchors),
      };
      systems.push({
        plan,
        barIds: barIds(score, plan),
        verticalKey: vertical.key,
        system,
        primitives: sink.primitives,
        anchors: sink.anchors,
      });
      cursor = advance(resolved, cursor, system);
    }
  }
  const systemList = systems.map(({ system }) => system);

  if (cache) {
    writeCache(cache, {
      measureKey: resolved.measureKey,
      systemKey: resolved.systemKey,
      bars,
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
      reusedSystems: kept.length,
    },
  };
}
