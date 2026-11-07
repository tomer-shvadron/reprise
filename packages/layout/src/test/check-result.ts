import { expect } from 'vitest';

import type { Id, Score } from '@reprise/model';

import type { Anchor, LayoutResult, Margins, Primitive, Rect, StaffType } from '../types';

const EPSILON = 0.02;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  );
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

function finiteNumbers(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, i) => {
      finiteNumbers(item, `${path}[${String(i)}]`, out);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) finiteNumbers(item, `${path}.${key}`, out);
  }
}

/** Paths of every non-finite number in the result. */
export function nonFinite(result: LayoutResult): string[] {
  const bad: string[] = [];
  finiteNumbers(result, 'result', bad);
  return bad;
}

/** Anchors that may not overlap: one kind, in one system, staff and voice. */
function group(anchor: Anchor): string {
  return [anchor.kind, anchor.system, anchor.track, anchor.staff, anchor.voice].join('|');
}

export function overlappingAnchors(result: LayoutResult): [Anchor, Anchor][] {
  const groups = new Map<string, Anchor[]>();
  for (const anchor of result.anchors) {
    const key = group(anchor);
    const members = groups.get(key);
    if (members) members.push(anchor);
    else groups.set(key, [anchor]);
  }
  const found: [Anchor, Anchor][] = [];
  for (const anchors of groups.values()) {
    const sorted = [...anchors].sort((a, b) => a.bbox.x - b.bbox.x);
    for (const [i, anchor] of sorted.entries()) {
      for (const other of sorted.slice(i + 1)) {
        if (other.bbox.x >= anchor.bbox.x + anchor.bbox.width) break;
        if (overlaps(anchor.bbox, other.bbox)) found.push([anchor, other]);
      }
    }
  }
  return found;
}

/** The structural invariants every result keeps, whatever the score. */
export function expectValid(result: LayoutResult): void {
  expect(nonFinite(result)).toEqual([]);

  let primitives = 0;
  let anchors = 0;
  for (const [i, system] of result.systems.entries()) {
    expect(system.index).toBe(i);
    expect(system.primitives.start).toBe(primitives);
    expect(system.anchors.start).toBe(anchors);
    primitives = system.primitives.end;
    anchors = system.anchors.end;
    expect(system.bars.end).toBeGreaterThan(system.bars.start);
    const previous = result.systems[i - 1];
    if ((system.part ?? 0) > 0) {
      // A continuation shares its system's bars and sits on the next page.
      expect(previous?.bars).toEqual(system.bars);
      expect(previous?.part).toBe((system.part ?? 0) - 1);
      expect(system.page).toBe((previous?.page ?? 0) + 1);
    } else if (previous) {
      expect(system.bars.start).toBe(previous.bars.end);
    }
    if (system.part === 0) expect(result.systems[i + 1]?.part).toBe(1);
    for (const anchor of result.anchors.slice(system.anchors.start, system.anchors.end)) {
      expect(anchor.system).toBe(i);
      expect(
        inside(anchor.bbox, system.bbox),
        `${anchor.kind} ${anchor.id} outside its system`,
      ).toBe(true);
    }
    const page = result.pages[system.page];
    expect(page).toBeDefined();
    if (page) {
      expect(system.index).toBeGreaterThanOrEqual(page.systems.start);
      expect(system.index).toBeLessThan(page.systems.end);
      expect(system.bbox.x + system.bbox.width).toBeLessThanOrEqual(
        page.bbox.x + page.bbox.width + EPSILON,
      );
    }
  }
  const seen = new Map<string, Set<string>>();
  for (const system of result.systems) {
    if (system.part === undefined) continue;
    const key = String(system.bars.start);
    const staves = seen.get(key) ?? new Set<string>();
    for (const staff of system.staves) {
      const name = `${staff.track}:${staff.type}`;
      expect(staves.has(name), `${name} in two parts of ${system.id}`).toBe(false);
      staves.add(name);
    }
    seen.set(key, staves);
  }
  expect(primitives).toBe(result.primitives.length);
  expect(anchors).toBe(result.anchors.length);
  expect(result.metrics.primitives).toBe(result.primitives.length);
  expect(result.metrics.anchors).toBe(result.anchors.length);
  expect(result.pages.length).toBeGreaterThan(0);
  expect(overlappingAnchors(result)).toEqual([]);
}

export interface PageOverflow {
  system: number;
  page: number;
  /** Primitives and anchors not inside the page box. */
  primitives: number;
  anchors: number;
  /** How far the furthest of them reaches past the page box. */
  overflowPx: number;
  /** How far the system box reaches past the page's right margin. */
  systemOverflowPx: number;
  /** How far the system box crosses the top or bottom margin. */
  marginOverflowPx: number;
}

function reach(inner: Rect, outer: Rect): number {
  return Math.max(
    0,
    outer.x - inner.x,
    outer.y - inner.y,
    inner.x + inner.width - (outer.x + outer.width),
    inner.y + inner.height - (outer.y + outer.height),
  );
}

/**
 * Systems that cross their page: a primitive or anchor outside the page box, or the system box
 * outside the page less its top and bottom margins. A system missing its page throws.
 */
export function outsideItsPage(
  result: LayoutResult,
  margins: Pick<Margins, 'top' | 'bottom'> & Partial<Pick<Margins, 'right'>>,
): PageOverflow[] {
  const found: PageOverflow[] = [];
  for (const system of result.systems) {
    const page = result.pages[system.page];
    if (!page) throw new Error(`${system.id} has no page`);
    const { bbox } = page;
    const top = bbox.y + margins.top;
    const bottom = bbox.y + bbox.height - margins.bottom;
    const marginOverflowPx = Math.max(
      0,
      top - system.bbox.y - EPSILON,
      system.bbox.y + system.bbox.height - bottom - EPSILON,
    );
    const right = bbox.x + bbox.width - (margins.right ?? 0);
    const systemOverflowPx = Math.max(0, system.bbox.x + system.bbox.width - right - EPSILON);
    let primitives = 0;
    let anchors = 0;
    let overflowPx = 0;
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      if (inside(primitive.bbox, bbox)) continue;
      primitives += 1;
      overflowPx = Math.max(overflowPx, reach(primitive.bbox, bbox));
    }
    for (const anchor of result.anchors.slice(system.anchors.start, system.anchors.end)) {
      if (inside(anchor.bbox, bbox)) continue;
      anchors += 1;
      overflowPx = Math.max(overflowPx, reach(anchor.bbox, bbox));
    }
    if (primitives > 0 || anchors > 0 || marginOverflowPx > 0) {
      found.push({
        system: system.index,
        page: page.index,
        primitives,
        anchors,
        overflowPx,
        systemOverflowPx,
        marginOverflowPx,
      });
    }
  }
  return found;
}

/**
 * Every system box inside its page less the top and bottom margins, and every primitive and
 * anchor inside its page box: nothing crosses a page edge.
 */
export function expectInsidePages(
  result: LayoutResult,
  margins: Pick<Margins, 'top' | 'bottom'>,
): void {
  for (const overflow of outsideItsPage(result, margins)) {
    const system = result.systems[overflow.system];
    const id = system?.id ?? String(overflow.system);
    expect(overflow.marginOverflowPx > 0, `${id} outside its page's margins`).toBe(false);
    if (overflow.primitives > 0)
      expect.fail(
        `${String(overflow.primitives)} primitives of ${id} outside page ${String(overflow.page)}`,
      );
    if (overflow.anchors > 0)
      expect.fail(
        `${String(overflow.anchors)} anchors of ${id} outside page ${String(overflow.page)}`,
      );
  }
}

/** The result without its metrics, which report how it was made rather than what it is. */
export function stable(result: LayoutResult): string {
  const { pages, systems, primitives, anchors } = result;
  return JSON.stringify({ pages, systems, primitives, anchors });
}

const MARK_GLYPHS = [
  'artic',
  'tremolo',
  'strings',
  'guitarFade',
  'guitarVolume',
  'ornamentTrill',
  'dynamic',
] as const;

function isMark(primitive: Primitive): boolean {
  if (primitive.kind === 'text') return true;
  return (
    primitive.kind === 'glyph' && MARK_GLYPHS.some((prefix) => primitive.glyph.startsWith(prefix))
  );
}

/**
 * Text and effect glyphs that overlap within one staff of one system, among those lying wholly
 * above its top line or below its bottom line: lane items, words and letters. Each mark belongs
 * to the staff whose anchor holds its centre; a mark in no staff's anchor is skipped.
 */
export function overlappingMarks(result: LayoutResult): [Primitive, Primitive][] {
  const found: [Primitive, Primitive][] = [];
  for (const system of result.systems) {
    const staves = result.anchors
      .slice(system.anchors.start, system.anchors.end)
      .filter((anchor) => anchor.kind === 'staff');
    const groups = new Map<number, Primitive[]>();
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      if (!isMark(primitive)) continue;
      const { bbox } = primitive;
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const index = staves.findIndex(
        (anchor) =>
          cx >= anchor.bbox.x &&
          cx <= anchor.bbox.x + anchor.bbox.width &&
          cy >= anchor.bbox.y &&
          cy <= anchor.bbox.y + anchor.bbox.height,
      );
      const anchor = staves[index];
      const staff = system.staves.find(
        (placement) => placement.track === anchor?.track && placement.type === anchor.staff,
      );
      if (!staff) continue;
      const outside =
        bbox.y + bbox.height <= staff.top + EPSILON || bbox.y >= staff.bottom - EPSILON;
      if (!outside) continue;
      const members = groups.get(index);
      if (members) members.push(primitive);
      else groups.set(index, [primitive]);
    }
    for (const marks of groups.values()) {
      const sorted = [...marks].sort((a, b) => a.bbox.x - b.bbox.x);
      for (const [i, mark] of sorted.entries()) {
        for (const other of sorted.slice(i + 1)) {
          if (other.bbox.x >= mark.bbox.x + mark.bbox.width) break;
          if (overlaps(mark.bbox, other.bbox)) found.push([mark, other]);
        }
      }
    }
  }
  return found;
}

/** Every beat, note and grace note id of the score, with the id of the track it belongs to. */
function owners(score: Score): Map<Id, Id> {
  const owner = new Map<Id, Id>();
  for (const track of score.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          owner.set(beat.id, track.id);
          for (const note of beat.notes) owner.set(note.id, track.id);
          for (const grace of beat.grace ?? []) {
            for (const note of grace.notes) owner.set(note.id, track.id);
          }
        }
      }
    }
  }
  return owner;
}

/** The staff of `track` whose anchor lies nearest the vertical span `y` to `y + height`. */
function nearestStaff(
  staves: readonly Anchor[],
  track: Id,
  y: number,
  height: number,
): StaffType | undefined {
  let nearest: Anchor | undefined;
  let best = Infinity;
  for (const anchor of staves) {
    if (anchor.track !== track) continue;
    const gap = Math.max(anchor.bbox.y - y, y + height - (anchor.bbox.y + anchor.bbox.height));
    if (gap < best) {
      best = gap;
      nearest = anchor;
    }
  }
  return nearest?.staff;
}

/**
 * Primitives a beat or note drew outside every staff of its track in its system: a staff's anchor
 * spans the staff, the room it measured and its lanes, so a primitive outside them is drawn
 * where nothing was measured for it and can land on another staff or another page. With `staff`,
 * only the strays nearest a staff of that type.
 */
export function strayPrimitives(
  result: LayoutResult,
  score: Score,
  staff?: StaffType,
): Primitive[] {
  const owner = owners(score);
  const stray: Primitive[] = [];
  for (const system of result.systems) {
    const staves = result.anchors
      .slice(system.anchors.start, system.anchors.end)
      .filter((anchor) => anchor.kind === 'staff');
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      const track = primitive.node === undefined ? undefined : owner.get(primitive.node);
      if (track === undefined) continue;
      const { y, height } = primitive.bbox;
      const held = staves.some(
        (anchor) =>
          anchor.track === track &&
          y >= anchor.bbox.y - EPSILON &&
          y + height <= anchor.bbox.y + anchor.bbox.height + EPSILON,
      );
      if (held) continue;
      if (staff === undefined || nearestStaff(staves, track, y, height) === staff) {
        stray.push(primitive);
      }
    }
  }
  return stray;
}
