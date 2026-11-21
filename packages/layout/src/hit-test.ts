import type { Id } from '@reprise/model';

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

/** `contains` for a box shifted right by `offsetX`, without building the shifted box. */
function containsShifted(box: Rect, offsetX: number, x: number, y: number): boolean {
  // y first: it rejects most anchors before the rounding.
  if (y < box.y || y > box.y + box.height) return false;
  const left = shiftedX(box, offsetX);
  return x >= left && x <= left + box.width;
}

const shiftedX = (box: Rect, offsetX: number): number =>
  offsetX === 0 ? box.x : round(box.x + offsetX);

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
        containsShifted(anchor.bbox, offsetX, x, y) &&
        (!best || moreSpecific(anchor, best))
      ) {
        best = anchor;
      }
    }
  }
  return best;
}

function shiftedBox(box: Rect, offsetX: number): Rect {
  return offsetX === 0 ? box : { ...box, x: shiftedX(box, offsetX) };
}

/** An anchor's box in layout space; the stored box itself when its system has no offset. */
export function anchorBox(result: LayoutResult, anchor: Anchor): Rect {
  return shiftedBox(anchor.bbox, result.systems[anchor.system]?.offsetX ?? 0);
}

/** What `markAt` finds under a point: a chord name's or diagram's beat or a section marker's master bar. */
export type Mark = { kind: 'chord'; beat: Id } | { kind: 'section'; masterBar: Id };

/**
 * The chord name or section marker under (x, y), in layout space, which `hitTest` does not report
 * because neither has an anchor of its own. Only the systems containing the point are scanned, and
 * a tempo mark, though keyed by the same master bar, is not a section.
 */
export function markAt(result: LayoutResult, x: number, y: number): Mark | undefined {
  for (const system of result.systems) {
    if (!contains(system.bbox, x, y)) continue;
    const offsetX = system.offsetX ?? 0;
    for (let i = system.primitives.start; i < system.primitives.end; i++) {
      const primitive = result.primitives[i];
      if (primitive?.node === undefined || !containsShifted(primitive.bbox, offsetX, x, y))
        continue;
      if (
        (primitive.kind === 'text' && primitive.lane === 'chord') ||
        (primitive.kind === 'path' && primitive.lane === 'chordDiagram')
      ) {
        return { kind: 'chord', beat: primitive.node };
      }
      if (
        (primitive.kind === 'text' || primitive.kind === 'path') &&
        primitive.lane === 'section'
      ) {
        return { kind: 'section', masterBar: primitive.node };
      }
    }
  }
  return undefined;
}
