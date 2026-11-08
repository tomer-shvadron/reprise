import { round } from './primitives';
import type { Anchor, AnchorKind, LayoutResult, Rect } from './types';

const SPECIFICITY: Record<AnchorKind, number> = {
  note: 4,
  beat: 3,
  bar: 2,
  staff: 1,
  system: 0,
};

function contains(box: Rect, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/** Whether `a` names a more specific node than `b`: by kind, then a track's over the column's, then size. */
function moreSpecific(a: Anchor, b: Anchor): boolean {
  if (SPECIFICITY[a.kind] !== SPECIFICITY[b.kind]) return SPECIFICITY[a.kind] > SPECIFICITY[b.kind];
  if ((a.track === undefined) !== (b.track === undefined)) return a.track !== undefined;
  return a.bbox.width * a.bbox.height < b.bbox.width * b.bbox.height;
}

/**
 * The most specific anchor under (x, y), in layout space; the stored anchor is returned, its box
 * in its system's frame: a note before its beat, a beat before its bar, a track's
 * bar before the master bar's column, and the smallest among equals. Only the systems containing
 * the point are searched.
 */
export function hitTest(result: LayoutResult, x: number, y: number): Anchor | undefined {
  let best: Anchor | undefined;
  for (const system of result.systems) {
    if (!contains(system.bbox, x, y)) continue;
    const offsetX = system.offsetX ?? 0;
    for (let i = system.anchors.start; i < system.anchors.end; i++) {
      const anchor = result.anchors[i];
      if (
        anchor &&
        contains(shiftedBox(anchor.bbox, offsetX), x, y) &&
        (!best || moreSpecific(anchor, best))
      ) {
        best = anchor;
      }
    }
  }
  return best;
}

function shiftedBox(box: Rect, offsetX: number): Rect {
  return offsetX === 0 ? box : { ...box, x: round(box.x + offsetX) };
}

/** An anchor's box in layout space; the stored box itself when its system has no offset. */
export function anchorBox(result: LayoutResult, anchor: Anchor): Rect {
  return shiftedBox(anchor.bbox, result.systems[anchor.system]?.offsetX ?? 0);
}
