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
 * The most specific anchor under (x, y): a note before its beat, a beat before its bar, a track's
 * bar before the master bar's column, and the smallest among equals. Only the systems containing
 * the point are searched.
 */
export function hitTest(result: LayoutResult, x: number, y: number): Anchor | undefined {
  let best: Anchor | undefined;
  for (const system of result.systems) {
    if (!contains(system.bbox, x, y)) continue;
    for (let i = system.anchors.start; i < system.anchors.end; i++) {
      const anchor = result.anchors[i];
      if (anchor && contains(anchor.bbox, x, y) && (!best || moreSpecific(anchor, best))) {
        best = anchor;
      }
    }
  }
  return best;
}
