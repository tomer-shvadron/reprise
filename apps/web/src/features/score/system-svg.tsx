import type { Primitive, Range, System } from '@reprise/layout';
import { memo, type ReactElement } from 'react';

import { renderPrimitive } from './primitive-shape';
import { samePrimitives, sameValue } from './primitive-svg';

interface SystemPrimitivesProps {
  primitives: readonly Primitive[];
  range: Range;
}

function SystemPrimitivesImpl({ primitives, range }: SystemPrimitivesProps): ReactElement[] {
  const elements: ReactElement[] = [];
  for (let i = range.start; i < range.end; i++) {
    const primitive = primitives[i];
    if (primitive) elements.push(renderPrimitive(primitive, i - range.start));
  }
  return elements;
}

/** Skips rendering while the system draws the same primitives, so a zoom change leaves it alone. */
export const SystemPrimitives = memo(SystemPrimitivesImpl, (prev, next) =>
  samePrimitives(prev.primitives, prev.range, next.primitives, next.range),
);

export interface SystemSvgProps {
  system: System;
  primitives: readonly Primitive[];
  zoom: number;
  /** Page-relative position in screen px. */
  left: number;
  top: number;
}

/** One system as an `<svg>` whose viewBox is its box in its own frame, so zoom is only a size. */
function SystemSvgImpl({ system, primitives, zoom, left, top }: SystemSvgProps) {
  const { y, width, height } = system.bbox;
  // The primitives are in the system's own frame, so a continuous segment moved by `left` is not redrawn.
  const x = system.bbox.x - (system.offsetX ?? 0);
  return (
    <svg
      className="score-system"
      data-system-id={system.id}
      viewBox={`${String(x)} ${String(y)} ${String(width)} ${String(height)}`}
      width={width * zoom}
      height={height * zoom}
      style={{ left, top }}
      aria-hidden="true"
      focusable="false"
    >
      <SystemPrimitives primitives={primitives} range={system.primitives} />
    </svg>
  );
}

/** Renders only a system that changed, so one edit re-renders one system, not those rebuilt equal. */
export const SystemSvg = memo(
  SystemSvgImpl,
  (prev, next) =>
    prev.zoom === next.zoom &&
    prev.left === next.left &&
    prev.top === next.top &&
    prev.system.id === next.system.id &&
    prev.system.offsetX === next.system.offsetX &&
    sameValue(prev.system.bbox, next.system.bbox) &&
    samePrimitives(
      prev.primitives,
      prev.system.primitives,
      next.primitives,
      next.system.primitives,
    ),
);
