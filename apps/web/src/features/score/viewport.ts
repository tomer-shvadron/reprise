import type { LayoutResult, Page, Range, Rect, System } from '@reprise/layout';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Screen px of empty space around the canvas. */
export const GUTTER = 32;

/** Elements the view renders besides pages and systems: description, sizer, canvas, overlays. */
export const VIEW_CHROME_ELEMENTS = 4;

/** Systems mounted beyond the visible ones, on each side. */
const OVERSCAN = 1;

const right = (rect: Rect) => rect.x + rect.width;
const bottom = (rect: Rect) => rect.y + rect.height;

/** The layout's drawn area from the origin: every page and every system, which may overflow its page. */
export function layoutExtent(layout: LayoutResult): Rect {
  let width = 0;
  let height = 0;
  for (const { bbox } of [...layout.pages, ...layout.systems]) {
    width = Math.max(width, right(bbox));
    height = Math.max(height, bottom(bbox));
  }
  return { x: 0, y: 0, width, height };
}

/** Where layout (0, 0) sits inside the scroll content, in screen px; a narrow canvas is centred. */
export function canvasOffset(viewport: Size, extent: Rect, zoom: number): Point {
  return { x: Math.max(GUTTER, (viewport.width - extent.width * zoom) / 2), y: GUTTER };
}

/** The scroll content's size in screen px. */
export function contentSize(offset: Point, extent: Rect, zoom: number): Size {
  return {
    width: 2 * offset.x + extent.width * zoom,
    height: 2 * GUTTER + extent.height * zoom,
  };
}

/** The layout point at the viewport's centre for a scroll position. */
export function centreFromScroll(
  scroll: Point,
  viewport: Size,
  zoom: number,
  offset: Point,
): Point {
  return {
    x: (scroll.x + viewport.width / 2 - offset.x) / zoom,
    y: (scroll.y + viewport.height / 2 - offset.y) / zoom,
  };
}

/** The scroll position that puts a layout point at the viewport's centre. */
export function scrollFromCentre(
  centre: Point,
  viewport: Size,
  zoom: number,
  offset: Point,
): Point {
  return {
    x: centre.x * zoom + offset.x - viewport.width / 2,
    y: centre.y * zoom + offset.y - viewport.height / 2,
  };
}

/** The viewport in layout px; no centre means the scroll origin. */
export function visibleWindow(
  centre: Point | undefined,
  viewport: Size,
  zoom: number,
  offset: Point,
): Rect {
  const width = viewport.width / zoom;
  const height = viewport.height / zoom;
  if (!centre) return { x: -offset.x / zoom, y: -offset.y / zoom, width, height };
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

function distance(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - right(b), b.x - right(a));
  const dy = Math.max(0, a.y - bottom(b), b.y - bottom(a));
  return Math.hypot(dx, dy);
}

/**
 * The systems to mount: those intersecting the window, plus one either side. With none in view
 * (a gap between pages, an empty viewport) the nearest system and its neighbours, so scrolling
 * never shows a blank page where notation is about to appear.
 */
export function mountedSystems(systems: readonly System[], window: Rect): Range {
  let first = -1;
  let last = -1;
  systems.forEach(({ bbox }, index) => {
    if (!intersects(bbox, window)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) {
    let nearest = Number.POSITIVE_INFINITY;
    systems.forEach(({ bbox }, index) => {
      const d = distance(bbox, window);
      if (d < nearest) {
        nearest = d;
        first = index;
      }
    });
    if (first < 0) return { start: 0, end: 0 };
    last = first;
  }
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(systems.length, last + 1 + OVERSCAN),
  };
}

/** Indices of the pages holding a mounted system or intersecting the window, ascending. */
export function mountedPages(
  pages: readonly Page[],
  systems: readonly System[],
  range: Range,
  window: Rect,
): number[] {
  const mounted = new Set<number>();
  for (let i = range.start; i < range.end; i++) {
    const system = systems[i];
    if (system) mounted.add(system.page);
  }
  for (const page of pages) if (intersects(page.bbox, window)) mounted.add(page.index);
  return [...mounted].sort((a, b) => a - b);
}

function revealAxis(start: number, size: number, from: number, length: number, margin: number) {
  if (from - margin < start || length + 2 * margin > size) return from - margin;
  if (from + length + margin > start + size) return from + length + margin - size;
  return start;
}

/** The nearest window origin that shows `rect` with `margin` around it; undefined when it already shows. */
export function revealScroll(window: Rect, rect: Rect, margin: number): Point | undefined {
  const x = revealAxis(window.x, window.width, rect.x, rect.width, margin);
  const y = revealAxis(window.y, window.height, rect.y, rect.height, margin);
  return x === window.x && y === window.y ? undefined : { x, y };
}

/** A pointer's client position in layout px, given the canvas's client rectangle. */
export function toLayoutPoint(client: Point, canvas: Point, zoom: number): Point {
  return { x: (client.x - canvas.x) / zoom, y: (client.y - canvas.y) / zoom };
}

/** Elements under the view's region for a mounted range and pages, overlays aside: the budget model. */
export function mountedElementCount(
  layout: LayoutResult,
  range: Range,
  pages: readonly number[],
): number {
  let count = VIEW_CHROME_ELEMENTS + pages.length;
  for (let i = range.start; i < range.end; i++) {
    const system = layout.systems[i];
    if (system) count += 1 + system.primitives.end - system.primitives.start;
  }
  return count;
}
