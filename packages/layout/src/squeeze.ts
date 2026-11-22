import type { Id } from '@reprise/model';

import { round } from './primitives';
import type { Anchor, Rect } from './types';

/** Overlaps narrower than this are rounding, as the result checks count them. */
const EPSILON = 0.02;

/** Anchors that may not overlap: one kind, system, track, staff and voice; any voice for notes on a five-line staff. */
function group(anchor: Anchor): string {
  const voice = anchor.kind === 'note' && anchor.staff !== 'tab' ? '' : anchor.voice;
  return [anchor.kind, anchor.system, anchor.track, anchor.staff, voice].join('|');
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  );
}

const centre = (bbox: Rect): number => bbox.x + bbox.width / 2;
const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Keeps hit boxes apart in a squeezed system, whose glyphs may overlap: note and beat anchors are
 * clipped to their bar, and two of one group that still overlap are cut where their centres'
 * midpoint falls. Replaces each changed anchor's `bbox` rather than mutating it.
 */
export function separateAnchors(
  anchors: Anchor[],
  spans: ReadonlyMap<Id, { left: number; right: number }>,
): void {
  const groups = new Map<string, number[]>();
  for (const [i, anchor] of anchors.entries()) {
    if (anchor.kind !== 'note' && anchor.kind !== 'beat') continue;
    const span = anchor.masterBar === undefined ? undefined : spans.get(anchor.masterBar);
    if (span) {
      const left = Math.max(anchor.bbox.x, round(span.left));
      const right = Math.min(anchor.bbox.x + anchor.bbox.width, round(span.right));
      anchors[i] = {
        ...anchor,
        bbox: { ...anchor.bbox, x: left, width: round(Math.max(0, right - left)) },
      };
    }
    const key = group(anchor);
    const members = groups.get(key);
    if (members) members.push(i);
    else groups.set(key, [i]);
  }
  for (const members of groups.values()) {
    const centres = new Map(members.map((i) => [i, centre(anchors[i]?.bbox ?? EMPTY)]));
    members.sort((a, b) => (centres.get(a) ?? 0) - (centres.get(b) ?? 0));
    for (const [n, b] of members.entries()) {
      for (const a of members.slice(0, n)) {
        const left = anchors[a];
        const right = anchors[b];
        if (!left || !right || !overlaps(left.bbox, right.bbox)) continue;
        const cut = round(((centres.get(a) ?? 0) + (centres.get(b) ?? 0)) / 2);
        const end = Math.min(left.bbox.x + left.bbox.width, cut);
        const start = Math.max(right.bbox.x, cut);
        const rightEnd = right.bbox.x + right.bbox.width;
        anchors[a] = {
          ...left,
          bbox: { ...left.bbox, width: round(Math.max(0, end - left.bbox.x)) },
        };
        anchors[b] = {
          ...right,
          bbox: { ...right.bbox, x: start, width: round(Math.max(0, rightEnd - start)) },
        };
      }
    }
  }
}
