import { expect } from 'vitest';

import type { Anchor, LayoutResult, Rect } from '../types';

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
  const bad: string[] = [];
  finiteNumbers(result, 'result', bad);
  expect(bad).toEqual([]);

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
    if (previous) expect(system.bars.start).toBe(previous.bars.end);
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
  expect(primitives).toBe(result.primitives.length);
  expect(anchors).toBe(result.anchors.length);
  expect(result.metrics.primitives).toBe(result.primitives.length);
  expect(result.metrics.anchors).toBe(result.anchors.length);
  expect(result.pages.length).toBeGreaterThan(0);
  expect(overlappingAnchors(result)).toEqual([]);
}

/** The result without its metrics, which report how it was made rather than what it is. */
export function stable(result: LayoutResult): string {
  const { pages, systems, primitives, anchors } = result;
  return JSON.stringify({ pages, systems, primitives, anchors });
}
