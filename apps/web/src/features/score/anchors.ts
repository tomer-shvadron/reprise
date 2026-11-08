import {
  anchorBox,
  type Anchor,
  type AnchorKind,
  type LayoutResult,
  type Rect,
} from '@reprise/layout';
import type { Id } from '@reprise/model';

export interface PlaybackCursor {
  /** The cursor line's x, in layout px. */
  x: number;
  /** The master-bar column anchor highlighted behind it. */
  bar: Anchor;
  /** The column's box in layout space. */
  box: Rect;
}

const indexes = new WeakMap<LayoutResult, ReadonlyMap<Id, readonly Anchor[]>>();

/** Anchors by model id; one id can have several (a beat on two staves, a staff per system). */
export function anchorIndex(layout: LayoutResult): ReadonlyMap<Id, readonly Anchor[]> {
  const cached = indexes.get(layout);
  if (cached) return cached;
  const index = new Map<Id, Anchor[]>();
  for (const anchor of layout.anchors) {
    const list = index.get(anchor.id);
    if (list) list.push(anchor);
    else index.set(anchor.id, [anchor]);
  }
  indexes.set(layout, index);
  return index;
}

export function findAnchors(layout: LayoutResult, id: Id, kind?: AnchorKind): readonly Anchor[] {
  const all = anchorIndex(layout).get(id) ?? [];
  return kind === undefined ? all : all.filter((anchor) => anchor.kind === kind);
}

/** The master bar's whole column in a system: the `bar` anchor without a track. */
export function columnAnchor(
  layout: LayoutResult,
  masterBarId: Id,
  system: number,
): Anchor | undefined {
  return findAnchors(layout, masterBarId, 'bar').find(
    (anchor) => anchor.track === undefined && anchor.system === system,
  );
}

/** The cursor for a note, beat or bar anchor: a note or beat at its centre, a bar at its left edge. */
export function cursorAt(layout: LayoutResult, anchor: Anchor): PlaybackCursor | undefined {
  if (anchor.masterBar === undefined) return undefined;
  const bar = columnAnchor(layout, anchor.masterBar, anchor.system);
  if (!bar) return undefined;
  const box = anchorBox(layout, anchor);
  if (anchor.kind === 'bar') return { x: box.x, bar, box: anchorBox(layout, bar) };
  if (anchor.kind === 'note' || anchor.kind === 'beat') {
    return { x: box.x + box.width / 2, bar, box: anchorBox(layout, bar) };
  }
  return undefined;
}

export function cursorForBeat(layout: LayoutResult, beatId: Id): PlaybackCursor | undefined {
  const [first] = findAnchors(layout, beatId, 'beat');
  return first ? cursorAt(layout, first) : undefined;
}

/**
 * A short description for screen readers: "300 bars, 100 pages". Pages are counted only where
 * systems stack down the page; a continuous layout's single page is an artifact of layout.
 */
export function describeLayout(layout: LayoutResult): string {
  const bars = layout.systems.at(-1)?.bars.end ?? 0;
  const pages = layout.pages.length;
  const first = layout.systems[0];
  const continuous = layout.systems.some(
    ({ bbox }) => first !== undefined && bbox.x > first.bbox.x && bbox.y === first.bbox.y,
  );
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
  return pages > 0 && !continuous
    ? `${plural(bars, 'bar')}, ${plural(pages, 'page')}`
    : plural(bars, 'bar');
}
