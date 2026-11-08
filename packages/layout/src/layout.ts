import type { Id, Score } from '@reprise/model';

import { breakSystems, type SystemPlan } from './breaking';
import {
  readCache,
  sameInputs,
  writeCache,
  type CachedBar,
  type CachedPart,
  type CachedSystem,
  type Cursor,
  type LayoutCache,
  type PartPlacement,
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
  samePlacement,
  samePlan,
  type ChangedBars,
} from './reuse';
import { staffBar, staffSlots, trackBar, type StaffSlot } from './slots';
import { partVertical, splitSlots } from './split';
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
  /** The cache entries in bar order. */
  entries: CachedBar[];
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
  const entries: CachedBar[] = [];
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
    entries.push(entry);
    measures.push(entry.measure);
  }
  changed[contexts.length] = measured;
  return { measures, bars, entries, measured, changed, lastChanged };
}

function barIds(score: Score, plan: SystemPlan): (Id | undefined)[] {
  const ids: (Id | undefined)[] = [];
  for (let i = plan.start; i <= plan.end; i++) ids.push(score.masterBars[i]?.id);
  return ids;
}

/** Per staff slot, the lanes bar `context` draws into; the repeat count's goes on the first. */
function barLanes(
  score: Score,
  context: BarContext,
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
): LaneRequests[] {
  const requests = slots.map((slot): LaneRequests => {
    const bar = trackBar(slot, context.index);
    return bar ? slot.module.lanes(staffBar(score, slot, bar, context, options.space)) : {};
  });
  const first = requests[0];
  if (first && context.masterBar.repeat.endCount > 2) {
    requests[0] = { ...first };
    mergeLanes(requests[0], { repeatCount: LANE_HEIGHT.repeatCount * options.space });
  }
  return requests;
}

/**
 * Brings every cached bar's lanes up to date in one forward pass. A bar's lanes follow from the
 * bar and the dynamic entering it, which follows from the entering one and the bar before; so
 * after a re-measured bar the entering dynamics are compared only until one matches again.
 */
function refreshLanes(
  score: Score,
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  entries: readonly CachedBar[],
): void {
  let propagating = false;
  for (const context of contexts) {
    const entry = entries[context.index];
    if (!entry) continue;
    const stored = entry.lanes;
    if (stored?.index === context.index && !propagating) continue;
    const entering = enteringDynamics(options.tracks, context.index);
    if (stored?.index === context.index && stored.entering === entering) {
      propagating = false;
      continue;
    }
    entry.lanes = {
      index: context.index,
      entering,
      requests: barLanes(score, context, slots, options),
    };
    propagating = true;
  }
}

/** Per staff slot, the lanes bars `start` to `end` (exclusive) draw into, each at its tallest. */
function laneRequests(
  slots: readonly StaffSlot[],
  lanesOf: (index: number) => readonly LaneRequests[],
  start: number,
  end: number,
): LaneRequests[] {
  const requests = slots.map((): LaneRequests => ({}));
  for (let index = start; index < end; index++) {
    for (const [i, bar] of lanesOf(index).entries()) {
      const into = requests[i];
      if (into) mergeLanes(into, bar);
    }
  }
  return requests;
}

function pageTop(options: ResolvedOptions, page: number): number {
  return page * (options.pageHeight + options.pageGap);
}

/** The first page gives `headerHeight` of its content area to the caller's header. */
function headerOn(options: ResolvedOptions, page: number): number {
  return page === 0 ? options.headerHeight : 0;
}

function pageStart(options: ResolvedOptions, page: number): Cursor {
  return {
    page,
    x: options.margins.left,
    y: pageTop(options, page) + options.margins.top + headerOn(options, page),
    empty: true,
  };
}

/**
 * Where a system's parts go. One that fits a page's content area flows on; a taller one is split
 * between its staves, its first part at the top of the current page if empty, else the next, and
 * each further part at the top of the page after. The first page's room is less its header, so a
 * system taller than that is split there too. `vertical.height` is compared unrounded.
 */
function placeSystem(
  options: ResolvedOptions,
  cursor: Cursor,
  vertical: VerticalLayout,
  groups: readonly number[],
): PartPlacement[] {
  const all = { start: 0, end: groups.length };
  if (options.mode === 'continuous') return [{ ...cursor, slots: all }];
  const { margins, pageHeight } = options;
  const room = pageHeight - margins.top - margins.bottom;
  const first = cursor.empty ? cursor.page : cursor.page + 1;
  const firstRoom = room - headerOn(options, first);
  if (vertical.height > firstRoom) {
    return splitSlots(vertical, groups, room, options.space, firstRoom).map((slots, j) => ({
      ...pageStart(options, first + j),
      slots,
    }));
  }
  const limit = pageTop(options, cursor.page) + pageHeight - margins.bottom;
  if (cursor.empty || cursor.y + vertical.height <= limit) return [{ ...cursor, slots: all }];
  return [{ ...pageStart(options, cursor.page + 1), slots: all }];
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
  const { measures, bars, entries, measured, changed, lastChanged } = measureAll(
    score,
    contexts,
    slots,
    resolved,
    state?.bars,
    new Set(options.dirtyBars ?? []),
  );

  if (cache) refreshLanes(score, contexts, slots, resolved, entries);
  const lanesOf = (index: number): readonly LaneRequests[] => {
    const cached = entries[index]?.lanes?.requests;
    if (cached) return cached;
    const context = contexts[index];
    return context ? barLanes(score, context, slots, resolved) : [];
  };
  /** Kept with each bar's lanes when there is a cache, which is the only time it is compared. */
  const entering = (index: number): string => entries[index]?.lanes?.entering ?? '';

  const global: VerticalLayout | undefined =
    resolved.mode === 'continuous'
      ? verticalLayout(
          score.masterBars,
          measures,
          slots,
          resolved,
          laneRequests(slots, lanesOf, 0, contexts.length),
        )
      : undefined;

  const previous = state && state.systemKey === resolved.systemKey ? state.systems : [];
  const sameBarCount = state?.barCount === score.masterBars.length;
  const systems: CachedSystem[] = [];
  let reused = 0;
  let primitiveCount = 0;
  let anchorCount = 0;
  let systemCount = 0;
  const keep = (entry: CachedSystem): void => {
    const parts = entry.parts.map((part) => {
      const primitives = { start: primitiveCount, end: primitiveCount + part.primitives.length };
      const anchors = { start: anchorCount, end: anchorCount + part.anchors.length };
      const placed = reposition(part, systemCount, primitives, anchors);
      primitiveCount = primitives.end;
      anchorCount = anchors.end;
      systemCount += 1;
      return placed;
    });
    const moved = parts.some((part, i) => part !== entry.parts[i]);
    systems.push(moved ? { ...entry, parts } : entry);
    reused += parts.length;
  };
  const groups = slots.map(({ group }) => group);
  /** The cursor after a system's last part. */
  const after = (entry: CachedSystem): Cursor => {
    const placement = entry.at.at(-1);
    const part = entry.parts.at(-1);
    return placement && part ? advance(resolved, placement, part.system) : pageStart(resolved, 0);
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
    let cursor: Cursor = last ? after(last) : pageStart(resolved, 0);
    const byStart = new Map<number, number>();
    for (let i = next; i < previous.length; i++) {
      const old = previous[i];
      if (old) byStart.set(old.plan.start, i);
    }
    for (const plan of breakSystems(measures, contexts, slots, resolved, last?.plan.end ?? 0)) {
      const position = byStart.get(plan.start);
      const old = position === undefined ? undefined : previous[position];
      if (old && position !== undefined && samePlan(old.plan, plan) && unchanged(old, plan)) {
        // The next placement follows from this one, the system's stack (its slots' extents and
        // rows) and the page geometry in `systemKey`, so equal placements converge.
        const at = placeSystem(resolved, cursor, old.vertical, groups);
        if (samePlacement(at, old.at) && entering(plan.start) === old.entering) {
          keep(old);
          cursor = after(old);
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
          laneRequests(slots, lanesOf, plan.start, plan.end),
        );
      const at = placeSystem(resolved, cursor, vertical, groups);
      const split = at.length > 1;
      const baseId = `system:${score.masterBars[plan.start]?.id ?? String(systemCount)}`;
      const parts = at.map((placement, j): CachedPart => {
        const index = systemCount;
        const id = j === 0 ? baseId : `${baseId}/${String(j)}`;
        const sink: LayoutSink = { primitives: [], anchors: [] };
        const rendered = renderSystem(
          {
            score,
            contexts,
            measures,
            slots,
            options: resolved,
            plan,
            vertical: split
              ? partVertical(vertical, groups, placement.slots, resolved.space)
              : vertical,
            x: placement.x,
            y: placement.y,
            index,
            id,
            part: placement.slots,
          },
          sink,
        );
        const system: System = {
          id,
          index,
          page: placement.page,
          ...(split && { part: j }),
          bars: { start: plan.start, end: plan.end },
          bbox: rendered.bbox,
          staves: rendered.staves,
          primitives: { start: primitiveCount, end: primitiveCount + sink.primitives.length },
          anchors: { start: anchorCount, end: anchorCount + sink.anchors.length },
        };
        primitiveCount += sink.primitives.length;
        anchorCount += sink.anchors.length;
        systemCount += 1;
        return { system, primitives: sink.primitives, anchors: sink.anchors };
      });
      const entry: CachedSystem = {
        plan,
        barIds: barIds(score, plan),
        verticalKey: vertical.key,
        at,
        vertical,
        entering: entering(plan.start),
        parts,
      };
      systems.push(entry);
      cursor = after(entry);
    }
  }
  const parts = systems.flatMap((entry) => entry.parts);
  const systemList = parts.map(({ system }) => system);
  // One copy per array: pushing item by item cost several times as much on the long score.
  const noPrimitives: Primitive[] = [];
  const noAnchors: Anchor[] = [];
  const primitives = noPrimitives.concat(...parts.map((part) => part.primitives));
  const anchors = noAnchors.concat(...parts.map((part) => part.anchors));

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
