import type { LayoutResult, Rect } from '@reprise/layout';
import type { Id } from '@reprise/model';

import type { OverlayBox } from './overlay-layer';

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
 * Where each of `beats` draws its chord: the box around its chord name and, when one is drawn, its
 * diagram, in layout space with the system's `offsetX` applied. A beat has one box per system part
 * that draws it, and none when its bar is not laid out (another track, or a hidden one).
 */
export function chordBoxes(layout: LayoutResult, beats: ReadonlySet<Id>): Map<Id, OverlayBox[]> {
  const found = new Map<Id, OverlayBox[]>();
  if (beats.size === 0) return found;
  for (const system of layout.systems) {
    const offsetX = system.offsetX ?? 0;
    const here = new Map<Id, Rect>();
    for (let i = system.primitives.start; i < system.primitives.end; i++) {
      const primitive = layout.primitives[i];
      const beat = primitive?.node;
      if (primitive === undefined || beat === undefined || !beats.has(beat)) continue;
      const isChord =
        (primitive.kind === 'text' && primitive.lane === 'chord') ||
        (primitive.kind === 'path' && primitive.lane === 'chordDiagram');
      if (!isChord) continue;
      const box = { ...primitive.bbox, x: primitive.bbox.x + offsetX };
      const known = here.get(beat);
      here.set(beat, known ? union(known, box) : box);
    }
    // The diagram's other primitives (dots, marks) lie inside its grid's box, so the grid's alone
    // frames it.
    for (const [beat, box] of here) {
      const list = found.get(beat);
      const entry = { system: system.index, box };
      if (list) list.push(entry);
      else found.set(beat, [entry]);
    }
  }
  return found;
}
