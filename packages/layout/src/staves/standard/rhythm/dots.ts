import type { Id } from '@reprise/model';

import { glyph, glyphWidth, type LayoutSink } from '../../../primitives';

/** Gap between a note head (or the previous dot) and a dot, in staff spaces. */
const DOT_GAP = 0.25;

/** Width the dots of a beat take after its rightmost head, their leading gap included. */
export function dotsWidth(dots: number, space: number, scale = 1): number {
  return dots * (glyphWidth('augmentationDot', space, scale) + DOT_GAP * space * scale);
}

/**
 * Rhythm dots after a head ending at `x`, one row per y. The y values are the spaces the dots
 * sit in, already moved off any line by the caller.
 */
export function drawDots(
  sink: LayoutSink,
  dots: number,
  x: number,
  ys: readonly number[],
  space: number,
  options: { scale?: number; node: Id },
): void {
  const scale = options.scale ?? 1;
  const step = glyphWidth('augmentationDot', space, scale) + DOT_GAP * space * scale;
  for (const y of ys) {
    for (let i = 0; i < dots; i++) {
      const left = x + DOT_GAP * space * scale + i * step;
      sink.primitives.push(glyph('augmentationDot', left, y, space, { scale, node: options.node }));
    }
  }
}
