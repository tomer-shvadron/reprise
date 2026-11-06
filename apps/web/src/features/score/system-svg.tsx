import type { Primitive, Range, System } from '@reprise/layout';
import { memo, type ReactElement } from 'react';

import { renderPrimitive } from './primitive-shape';
import { samePrimitives } from './primitive-svg';

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

/** Skips rendering while the system's primitives are the same objects, as layout's cache keeps them. */
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

/** One system as an `<svg>` whose viewBox is its box in layout px, so zoom is only a size. */
export function SystemSvg({ system, primitives, zoom, left, top }: SystemSvgProps) {
  const { x, y, width, height } = system.bbox;
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
