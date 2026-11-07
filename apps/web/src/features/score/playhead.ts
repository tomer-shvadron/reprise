import type { Anchor, LayoutResult, Rect, System } from '@reprise/layout';
import { beatTicks, playedBarTicks, type Id, type Score } from '@reprise/model';

import { findAnchors, type PlaybackCursor } from './anchors';
import { distance, type Point } from './viewport';

const EPSILON = 1e-6;

interface BeatInfo {
  masterBarIndex: number;
  /** Ticks from the start of its bar, in its voice. */
  tick: number;
  /** The only beat of its voice and a rest: the tab staff centres it, away from its onset. */
  loneRest: boolean;
}

interface ScoreIndex {
  barIndex: ReadonlyMap<Id, number>;
  beats: ReadonlyMap<Id, BeatInfo>;
  /** Note id, grace notes included, to its beat's id. */
  noteBeat: ReadonlyMap<Id, Id>;
}

const scoreIndexes = new WeakMap<Score, ScoreIndex>();

function scoreIndex(score: Score): ScoreIndex {
  const cached = scoreIndexes.get(score);
  if (cached) return cached;
  const barIndex = new Map(score.masterBars.map((bar, index) => [bar.id, index]));
  const beats = new Map<Id, BeatInfo>();
  const noteBeat = new Map<Id, Id>();
  for (const track of score.tracks) {
    track.bars.forEach((bar, masterBarIndex) => {
      for (const voice of bar.voices) {
        let tick = 0;
        for (const beat of voice.beats) {
          const loneRest = beat.rest && voice.beats.length === 1;
          beats.set(beat.id, { masterBarIndex, tick, loneRest });
          for (const note of beat.notes) noteBeat.set(note.id, beat.id);
          for (const grace of beat.grace ?? []) {
            for (const note of grace.notes) noteBeat.set(note.id, beat.id);
          }
          tick += beatTicks(beat);
        }
      }
    });
  }
  const index = { barIndex, beats, noteBeat };
  scoreIndexes.set(score, index);
  return index;
}

/** The index of a master bar in the score, or -1. */
export function masterBarIndexOf(score: Score, id: Id): number {
  return scoreIndex(score).barIndex.get(id) ?? -1;
}

interface OnsetPoint {
  tick: number;
  x: number;
}

/** A master bar's column and the x of each onset in it: what the playhead moves along. */
interface BarOnsets {
  column: Anchor;
  /** The bar's played length. */
  ticks: number;
  points: readonly OnsetPoint[];
}

interface LayoutIndex {
  score: Score;
  /** Beat anchors by master-bar id. */
  beatAnchors: ReadonlyMap<Id, readonly Anchor[]>;
  bars: Map<Id, BarOnsets | null>;
}

const layoutIndexes = new WeakMap<LayoutResult, LayoutIndex>();

function layoutIndex(layout: LayoutResult, score: Score): LayoutIndex {
  const cached = layoutIndexes.get(layout);
  if (cached?.score === score) return cached;
  const beatAnchors = new Map<Id, Anchor[]>();
  for (const anchor of layout.anchors) {
    if (anchor.kind !== 'beat' || anchor.masterBar === undefined) continue;
    const list = beatAnchors.get(anchor.masterBar);
    if (list) list.push(anchor);
    else beatAnchors.set(anchor.masterBar, [anchor]);
  }
  const index = { score, beatAnchors, bars: new Map<Id, BarOnsets | null>() };
  layoutIndexes.set(layout, index);
  return index;
}

const centre = (rect: Rect) => rect.x + rect.width / 2;

/** The master bar's whole column: the `bar` anchor with no track, one per master bar. */
function columnOf(layout: LayoutResult, masterBarId: Id): Anchor | undefined {
  return findAnchors(layout, masterBarId, 'bar').find((anchor) => anchor.track === undefined);
}

function barOnsets(layout: LayoutResult, score: Score, masterBarId: Id): BarOnsets | undefined {
  const index = layoutIndex(layout, score);
  const cached = index.bars.get(masterBarId);
  if (cached !== undefined) return cached ?? undefined;
  const column = columnOf(layout, masterBarId);
  const masterBarIndex = masterBarIndexOf(score, masterBarId);
  if (!column || masterBarIndex < 0) {
    index.bars.set(masterBarId, null);
    return undefined;
  }
  const { beats } = scoreIndex(score);
  const found: OnsetPoint[] = [];
  for (const anchor of index.beatAnchors.get(masterBarId) ?? []) {
    const beat = beats.get(anchor.id);
    if (anchor.system !== column.system || !beat || beat.loneRest) continue;
    found.push({ tick: beat.tick, x: centre(anchor.bbox) });
  }
  // Stable, so among staves at one onset the first anchor, the top staff, stays.
  found.sort((a, b) => a.tick - b.tick);
  const points: OnsetPoint[] = [];
  for (const point of found) {
    const last = points.at(-1);
    if (!last || point.tick - last.tick > EPSILON) points.push(point);
  }
  const bar = { column, ticks: playedBarTicks(score, masterBarIndex), points };
  index.bars.set(masterBarId, bar);
  return bar;
}

/** x at `tick` into the bar: linear between onsets, then towards the column's right edge. */
function xAt(bar: BarOnsets, tick: number): number {
  const { column, ticks, points } = bar;
  const left = { tick: 0, x: column.bbox.x };
  const end = { tick: ticks, x: column.bbox.x + column.bbox.width };
  const first = points[0];
  const path = first && first.tick <= EPSILON ? points : [left, ...points];
  let from = path[0] ?? left;
  let to = end;
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (!point || point.tick > tick + EPSILON) break;
    from = point;
    to = path[i + 1] ?? end;
  }
  const span = to.tick - from.tick;
  if (span <= EPSILON) return from.x;
  const t = Math.min(Math.max((tick - from.tick) / span, 0), 1);
  return from.x + (to.x - from.x) * t;
}

/**
 * The playhead `tick` into master bar `masterBarId`: x on the bar's onset timeline, which covers
 * every visible staff, and the column it highlights. Undefined for a bar the layout does not hold.
 */
export function playheadAt(
  layout: LayoutResult,
  score: Score,
  masterBarId: Id,
  tick: number,
): PlaybackCursor | undefined {
  const bar = barOnsets(layout, score, masterBarId);
  return bar && { x: xAt(bar, tick), bar: bar.column };
}

/**
 * The master-bar column at or nearest `point` (layout px) among `systems`: the system containing
 * it, else the nearest, then the column containing its x, else the nearest by x. This covers the
 * gaps between systems, the margins and a system's clef and key.
 */
export function nearestColumn(
  layout: LayoutResult,
  systems: readonly System[],
  point: Point,
): Anchor | undefined {
  let system: System | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of systems) {
    const d = distance(candidate.bbox, { ...point, width: 0, height: 0 });
    if (d < best) {
      best = d;
      system = candidate;
    }
  }
  if (!system) return undefined;
  let column: Anchor | undefined;
  best = Number.POSITIVE_INFINITY;
  for (let i = system.anchors.start; i < system.anchors.end; i++) {
    const anchor = layout.anchors[i];
    if (!anchor || anchor.kind !== 'bar' || anchor.track !== undefined) continue;
    const { x, width } = anchor.bbox;
    const d = Math.max(0, x - point.x, point.x - (x + width));
    if (d < best) {
      best = d;
      column = anchor;
    }
  }
  return column;
}

export interface PointerTarget {
  masterBarIndex: number;
  masterBarId: Id;
  /** Ticks into the bar. */
  tick: number;
  /** The track of the staff under the pointer, if any. */
  track?: Id;
}

/**
 * Where a click seeks to: a note or beat's own onset, else the onset in the column nearest the
 * point's x, which is the bar's start near its barline, in its clef and key and in a margin.
 */
export function pointerTarget(
  layout: LayoutResult,
  score: Score,
  hit: { point: Point; anchor: Anchor | undefined; column: Anchor | undefined },
): PointerTarget | undefined {
  const { anchor, column, point } = hit;
  const index = scoreIndex(score);
  const track = anchor?.track;
  const beatId =
    anchor?.kind === 'beat'
      ? anchor.id
      : anchor?.kind === 'note'
        ? index.noteBeat.get(anchor.id)
        : undefined;
  const beat = beatId === undefined ? undefined : index.beats.get(beatId);
  if (beat) {
    const masterBar = score.masterBars[beat.masterBarIndex];
    if (masterBar) {
      return {
        masterBarIndex: beat.masterBarIndex,
        masterBarId: masterBar.id,
        tick: beat.tick,
        ...(track !== undefined && { track }),
      };
    }
  }
  const masterBarId = column?.id;
  if (masterBarId === undefined) return undefined;
  const masterBarIndex = masterBarIndexOf(score, masterBarId);
  if (masterBarIndex < 0) return undefined;
  const bar = barOnsets(layout, score, masterBarId);
  let tick = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const onset of bar?.points ?? []) {
    const d = Math.abs(onset.x - point.x);
    if (d < nearest) {
      nearest = d;
      tick = onset.tick;
    }
  }
  return { masterBarIndex, masterBarId, tick, ...(track !== undefined && { track }) };
}

/** The column of every master bar from `startBar` to `endBar`, in score order. */
export function barColumns(
  layout: LayoutResult,
  score: Score,
  range: { startBar: Id; endBar: Id },
): Anchor[] {
  const start = masterBarIndexOf(score, range.startBar);
  const end = masterBarIndexOf(score, range.endBar);
  if (start < 0 || end < 0) return [];
  const columns: Anchor[] = [];
  for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
    const id = score.masterBars[i]?.id;
    const column = id === undefined ? undefined : columnOf(layout, id);
    if (column) columns.push(column);
  }
  return columns;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The union of a track's staff anchors in a system: the band to keep in view when it is tall. */
export function staffBand(layout: LayoutResult, track: Id, system: number): Rect | undefined {
  let band: Rect | undefined;
  for (const anchor of findAnchors(layout, track, 'staff')) {
    if (anchor.system !== system) continue;
    band = band ? union(band, anchor.bbox) : anchor.bbox;
  }
  return band;
}
