import type { Id, StrokeDirection } from '@reprise/model';

import { ARROW_LENGTH, arrowhead, line, type LayoutSink } from '../../primitives';
import { WAVES, verticalWave } from './shapes';

const STROKE_THICKNESS = 0.12;

/**
 * An arpeggio's wave or a brush's line at `at` from `top` to `bottom`, with an arrowhead toward
 * the top (string 1, the highest pitch) for a downstroke and toward the bottom for an upstroke.
 */
export function drawStroke(
  sink: LayoutSink,
  at: number,
  top: number,
  bottom: number,
  stroke: { direction: StrokeDirection; arpeggio: boolean },
  space: number,
  node: Id,
): void {
  const arrow = ARROW_LENGTH * space;
  const towardTop = stroke.direction === 'down';
  const [from, to] = towardTop ? [bottom, top + arrow] : [top, bottom - arrow];
  if (stroke.arpeggio) {
    const wave = verticalWave(from, to, at, WAVES.slight, space, { node });
    if (wave) sink.primitives.push(wave);
  } else {
    sink.primitives.push(line(at, from, at, to, STROKE_THICKNESS * space, { node }));
  }
  sink.primitives.push(
    arrowhead(at, towardTop ? top : bottom, towardTop ? 'up' : 'down', space, { node }),
  );
}
