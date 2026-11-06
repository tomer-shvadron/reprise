import type { Id } from '@reprise/model';

import { engraving } from '../../../metrics';
import type { LayoutSink } from '../../../primitives';
import { arc } from './shapes';

export type ArcDirection = 'up' | 'down';

/** A tie's endpoints sit this far off the note head's centre, in staff spaces. */
export const TIE_OFFSET = 0.35;
const MIN_HEIGHT = 0.35;
const MAX_HEIGHT = 0.9;

/** How far a tie spanning `width` px bulges, in px. */
export function tieHeight(width: number, space: number): number {
  return Math.min(MAX_HEIGHT * space, Math.max(MIN_HEIGHT * space, width * 0.12));
}

/** Room a tie takes beyond its note's centre, in px. */
export function tieReach(space: number): number {
  return (TIE_OFFSET + MAX_HEIGHT) * space;
}

/** A tie from x1 to x2 beside a note head centred at `y`. */
export function drawTie(
  sink: LayoutSink,
  x1: number,
  x2: number,
  y: number,
  direction: ArcDirection,
  space: number,
  node: Id,
): void {
  if (x2 - x1 < space * 0.2) return;
  const sign = direction === 'up' ? -1 : 1;
  const height = tieHeight(x2 - x1, space) * sign;
  sink.primitives.push(
    arc(
      x1,
      x2,
      y + sign * TIE_OFFSET * space,
      height,
      engraving.tieMidpointThickness * space,
      node,
    ),
  );
}
