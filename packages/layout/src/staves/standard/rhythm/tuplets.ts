import type { Id } from '@reprise/model';

import { engraving, glyphMetrics, type GlyphName } from '../../../metrics';
import { glyph, glyphWidth, polyline, type LayoutSink } from '../../../primitives';

const DIGITS: readonly GlyphName[] = [
  'tuplet0',
  'tuplet1',
  'tuplet2',
  'tuplet3',
  'tuplet4',
  'tuplet5',
  'tuplet6',
  'tuplet7',
  'tuplet8',
  'tuplet9',
];

/** Gap between the notes' outer edge and the tuplet mark, in staff spaces. */
const CLEARANCE = 0.5;
const HOOK = 0.5;
const NUMBER_GAP = 0.3;

function digits(n: number): GlyphName[] {
  return Array.from(String(Math.max(0, Math.trunc(n))), (d) => DIGITS[Number(d)] ?? 'tuplet0');
}

function numberHeight(space: number): number {
  const { top, bottom } = glyphMetrics('tuplet3').bbox;
  return (top - bottom) * space;
}

/** How far a tuplet mark reaches past `edge`, the notes' outer edge on its side, in px. */
export function tupletReach(space: number): number {
  return CLEARANCE * space + numberHeight(space);
}

export interface TupletMark {
  n: number;
  /** Horizontal extent: the first note's left edge and the last note's right edge. */
  left: number;
  right: number;
  /** The outermost y of the notes and stems on the mark's side. */
  edge: number;
  above: boolean;
  /** A bracket when the tuplet is not exactly one beamed group; otherwise the number alone. */
  bracket: boolean;
}

/** A tuplet's number, centred over its notes, in a bracket open towards them when asked. */
export function drawTuplet(sink: LayoutSink, mark: TupletMark, space: number, node: Id): void {
  const names = digits(mark.n);
  const width = names.reduce((sum, name) => sum + glyphWidth(name, space), 0);
  const height = numberHeight(space);
  const sign = mark.above ? -1 : 1;
  const centre = mark.edge + sign * (CLEARANCE * space + height / 2);
  const baseline = centre + height / 2;
  const middle = (mark.left + mark.right) / 2;
  let x = middle - width / 2;
  for (const name of names) {
    sink.primitives.push(glyph(name, x, baseline, space, { node }));
    x += glyphWidth(name, space);
  }
  if (!mark.bracket) return;
  const thickness = engraving.tupletBracketThickness * space;
  const hook = centre - sign * HOOK * space;
  const gap = width / 2 + NUMBER_GAP * space;
  sink.primitives.push(
    polyline(
      [
        [mark.left, hook],
        [mark.left, centre],
        [middle - gap, centre],
      ],
      thickness,
      { node },
    ),
    polyline(
      [
        [middle + gap, centre],
        [mark.right, centre],
        [mark.right, hook],
      ],
      thickness,
      { node },
    ),
  );
}
