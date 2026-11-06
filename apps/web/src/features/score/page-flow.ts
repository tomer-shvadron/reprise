import type { LayoutResult, Page, Rect, System } from '@reprise/layout';

import type { Point } from './viewport';

/**
 * The pages as the screen draws them. A system taller than its page overflows into the next
 * page's space until layout breaks it (#85); on screen its paper grows to hold it and every later
 * page moves down by the growth, so nothing hides under the next sheet. Print keeps the page size.
 */
export interface PageFlow {
  /** Pages grown to hold their systems and moved down by the growth above them. */
  pages: readonly Page[];
  /** Systems moved with their page; primitives and anchors keep layout px. */
  systems: readonly System[];
  /** How far each page moved down, by page index, in layout px. */
  shifts: readonly number[];
}

/** A page's paper height that holds every system on it: at least the page, more on overflow. */
export function paperHeight(page: Page, systems: readonly System[]): number {
  let bottom = page.bbox.y + page.bbox.height;
  for (const { bbox } of systems) bottom = Math.max(bottom, bbox.y + bbox.height);
  return bottom - page.bbox.y;
}

const moveDown = <T extends { bbox: Rect }>(item: T, by: number, height = item.bbox.height): T =>
  by === 0 && height === item.bbox.height
    ? item
    : { ...item, bbox: { ...item.bbox, y: item.bbox.y + by, height } };

export function pageFlow(layout: LayoutResult): PageFlow {
  const shifts: number[] = [];
  let shift = 0;
  const pages = layout.pages.map((page) => {
    shifts.push(shift);
    const height = paperHeight(page, layout.systems.slice(page.systems.start, page.systems.end));
    const drawn = moveDown(page, shift, height);
    shift += height - page.bbox.height;
    return drawn;
  });
  if (shift === 0) return { pages: layout.pages, systems: layout.systems, shifts };
  const systems = layout.systems.map((system) => moveDown(system, shifts[system.page] ?? 0));
  return { pages, systems, shifts };
}

/** The page drawn at a view y: the last one starting at or above it. */
export function pageAt(flow: PageFlow, y: number): Page | undefined {
  let found = flow.pages[0];
  for (const page of flow.pages) {
    if (page.bbox.y > y) break;
    found = page;
  }
  return found;
}

/** How far a system was moved down. */
export function systemShift(flow: PageFlow, layout: LayoutResult, system: number): number {
  return flow.shifts[layout.systems[system]?.page ?? 0] ?? 0;
}

/** The page layout placed at a layout y: the last one starting at or above it. */
function layoutPageAt(layout: LayoutResult, y: number): Page | undefined {
  let found = layout.pages[0];
  for (const page of layout.pages) {
    if (page.bbox.y > y) break;
    found = page;
  }
  return found;
}

/**
 * A layout rect in view px. Give the system it lies in for a rect inside a system that overflows
 * its page, where the layout y alone points at the next page.
 */
export function toViewRect(
  flow: PageFlow,
  layout: LayoutResult,
  rect: Rect,
  system?: number,
): Rect {
  const shift =
    system === undefined
      ? (flow.shifts[layoutPageAt(layout, rect.y)?.index ?? 0] ?? 0)
      : systemShift(flow, layout, system);
  return shift === 0 ? rect : { ...rect, y: rect.y + shift };
}

/** A view point in layout px, and the page it falls on. */
export function toLayoutY(flow: PageFlow, point: Point): { point: Point; page: Page | undefined } {
  const page = pageAt(flow, point.y);
  const shift = flow.shifts[page?.index ?? 0] ?? 0;
  return { point: shift === 0 ? point : { x: point.x, y: point.y - shift }, page };
}
