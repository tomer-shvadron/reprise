import { anchorBox, type LayoutResult, type Rect } from '@reprise/layout';
import type { Id, Score } from '@reprise/model';

import { barColumns, staffBand, type OverlayBox, type ScoreOverlays } from '@/features/score';
import type { BarRange } from '@/state/selection';

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

/**
 * The bars' columns joined into one box per system part, in score order and in layout px: where
 * the pill anchors. From the columns the overlays already draw, so no layout runs for it.
 */
export function pillAnchor(layout: LayoutResult, score: Score, bars: BarRange): OverlayBox[] {
  const bySystem = new Map<number, Rect>();
  for (const column of barColumns(layout, score, bars)) {
    const box = anchorBox(layout, column);
    const known = bySystem.get(column.system);
    bySystem.set(column.system, known ? union(known, box) : box);
  }
  return [...bySystem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([system, box]) => ({ system, box }));
}

/**
 * The staff band nearest above a part that overlaps it horizontally: another track's staves in
 * the same system, or the staves of an earlier system on the same page. Bar numbers, chord names
 * and tempo marks do not count. Undefined when nothing lies above, as at a page's first staff.
 */
export function lineAbove(layout: LayoutResult, part: OverlayBox): Rect | undefined {
  const own = layout.systems[part.system];
  if (!own) return undefined;
  const { box } = part;
  let nearest: Rect | undefined;
  for (const system of layout.systems) {
    if (system.page !== own.page || system.index > own.index) continue;
    const { bbox } = system;
    if (bbox.x >= box.x + box.width || box.x >= bbox.x + bbox.width) continue;
    for (const staff of system.staves) {
      // A staff that starts at or below the part's top is the part's own, not above it.
      if (staff.bottom > box.y + 0.5) continue;
      if (nearest && staff.bottom <= nearest.y + nearest.height) continue;
      nearest = { x: bbox.x, y: staff.top, width: bbox.width, height: staff.bottom - staff.top };
    }
  }
  return nearest;
}

/**
 * Where the pill anchors in edit mode: the edit range's boxes, else the caret widened to its
 * track's staff band on that system, so the pill sits above the staff and not over the strings
 * above the cursor. One box per system part. Layout px.
 */
export function editAnchor(
  layout: LayoutResult,
  edit: Pick<ScoreOverlays, 'caret' | 'range'>,
  track: Id | undefined,
): OverlayBox[] {
  if (edit.range && edit.range.length > 0) return edit.range.filter((part) => !part.muted);
  if (!edit.caret || track === undefined) return [];
  const bySystem = new Map<number, Rect>();
  for (const part of edit.caret) {
    const band = staffBand(layout, track, part.system);
    const box = band ? { ...part.box, y: band.y, height: band.height } : part.box;
    const known = bySystem.get(part.system);
    bySystem.set(part.system, known ? union(known, box) : box);
  }
  return [...bySystem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([system, box]) => ({ system, box }));
}
