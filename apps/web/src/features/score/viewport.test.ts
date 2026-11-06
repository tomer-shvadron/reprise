import type { LayoutResult, Page, Rect, System } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import {
  canvasOffset,
  centreFromScroll,
  contentSize,
  GUTTER,
  layoutExtent,
  mountedPages,
  mountedSystems,
  revealScroll,
  scrollFromCentre,
  toLayoutPoint,
  visibleWindow,
} from './viewport';

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

function system(index: number, bbox: Rect, page = 0): System {
  return {
    id: `system:${String(index)}`,
    index,
    page,
    bars: { start: index, end: index + 1 },
    bbox,
    staves: [],
    primitives: { start: 0, end: 0 },
    anchors: { start: 0, end: 0 },
  };
}

function page(index: number, bbox: Rect, systems = { start: 0, end: 0 }): Page {
  return { index, bbox, systems };
}

/** Ten systems stacked 100 px apart, 80 px tall, two to a 200 px page. */
const stacked = Array.from({ length: 10 }, (_, i) =>
  system(i, rect(10, i * 100, 300, 80), Math.floor(i / 2)),
);
const pages = Array.from({ length: 5 }, (_, i) => page(i, rect(0, i * 200, 320, 200)));

describe('extent and offsets', () => {
  it('covers a system that overflows its page', () => {
    const layout: LayoutResult = {
      pages: [page(0, rect(0, 0, 794, 1123))],
      systems: [system(0, rect(48, 48, 698, 1445))],
      primitives: [],
      anchors: [],
      metrics: { layoutMs: 0, primitives: 0, anchors: 0, measuredBars: 0, reusedSystems: 0 },
    };
    expect(layoutExtent(layout)).toEqual(rect(0, 0, 794, 1493));
  });

  it('centres a canvas narrower than the viewport and keeps a gutter otherwise', () => {
    const extent = rect(0, 0, 800, 3000);
    expect(canvasOffset({ width: 1920, height: 1080 }, extent, 1)).toEqual({ x: 560, y: GUTTER });
    expect(canvasOffset({ width: 1000, height: 1080 }, extent, 2)).toEqual({
      x: GUTTER,
      y: GUTTER,
    });
    expect(contentSize({ x: GUTTER, y: GUTTER }, extent, 2)).toEqual({
      width: 1600 + 2 * GUTTER,
      height: 6000 + 2 * GUTTER,
    });
  });

  it('round-trips the centre through the scroll position at every zoom', () => {
    const viewport = { width: 1280, height: 720 };
    const offset = { x: 40, y: GUTTER };
    for (const zoom of [0.5, 1, 1.75, 3]) {
      const centre = { x: 321.5, y: 4567.25 };
      const back = centreFromScroll(
        scrollFromCentre(centre, viewport, zoom, offset),
        viewport,
        zoom,
        offset,
      );
      expect(back.x).toBeCloseTo(centre.x);
      expect(back.y).toBeCloseTo(centre.y);
    }
  });

  it('reads the window at the scroll origin and around a centre', () => {
    const viewport = { width: 800, height: 600 };
    expect(visibleWindow(undefined, viewport, 2, { x: 40, y: 32 })).toEqual(
      rect(-20, -16, 400, 300),
    );
    expect(visibleWindow({ x: 500, y: 500 }, viewport, 1, { x: 40, y: 32 })).toEqual(
      rect(100, 200, 800, 600),
    );
  });
});

describe('mountedSystems', () => {
  it('mounts the visible systems plus one either side', () => {
    expect(mountedSystems(stacked, rect(0, 0, 400, 150))).toEqual({ start: 0, end: 3 });
    expect(mountedSystems(stacked, rect(0, 420, 400, 150))).toEqual({ start: 3, end: 7 });
    expect(mountedSystems(stacked, rect(0, 950, 400, 150))).toEqual({ start: 8, end: 10 });
  });

  it('mounts the nearest system and its neighbours when none is visible', () => {
    expect(mountedSystems(stacked, rect(0, 385, 400, 10))).toEqual({ start: 2, end: 5 });
    expect(mountedSystems(stacked, rect(0, 5000, 400, 10))).toEqual({ start: 8, end: 10 });
    expect(mountedSystems(stacked, rect(0, 0, 0, 0))).toEqual({ start: 0, end: 2 });
  });

  it('handles no systems and systems running right', () => {
    expect(mountedSystems([], rect(0, 0, 100, 100))).toEqual({ start: 0, end: 0 });
    const row = Array.from({ length: 10 }, (_, i) => system(i, rect(i * 640, 16, 640, 400)));
    expect(mountedSystems(row, rect(1300, 0, 1000, 500))).toEqual({ start: 1, end: 5 });
  });
});

describe('mountedPages', () => {
  it('lists the pages of mounted systems and the visible pages', () => {
    expect(mountedPages(pages, stacked, { start: 3, end: 7 }, rect(0, 420, 400, 150))).toEqual([
      1, 2, 3,
    ]);
    expect(mountedPages(pages, stacked, { start: 0, end: 0 }, rect(0, 650, 400, 10))).toEqual([3]);
  });
});

describe('revealScroll', () => {
  const window = rect(100, 100, 400, 300);

  it('does nothing when the rect shows', () => {
    expect(revealScroll(window, rect(150, 150, 50, 50), 10)).toBeUndefined();
  });

  it('scrolls the least distance on each side', () => {
    expect(revealScroll(window, rect(150, 50, 50, 20), 10)).toEqual({ x: 100, y: 40 });
    expect(revealScroll(window, rect(150, 450, 50, 20), 10)).toEqual({ x: 100, y: 180 });
    expect(revealScroll(window, rect(20, 150, 50, 20), 10)).toEqual({ x: 10, y: 100 });
    expect(revealScroll(window, rect(480, 150, 50, 20), 10)).toEqual({ x: 140, y: 100 });
  });
});

describe('toLayoutPoint', () => {
  it('undoes the canvas position and the zoom', () => {
    expect(toLayoutPoint({ x: 300, y: 500 }, { x: 100, y: 100 }, 2)).toEqual({ x: 100, y: 200 });
  });
});
