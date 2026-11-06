import type { Id } from '@reprise/model';

import { rect, round } from '../../../primitives';
import type { PathPrimitive } from '../../../types';

const f = (value: number): string => String(round(value));

/** A filled polygon through `points`. */
export function polygon(points: readonly (readonly [number, number])[], node?: Id): PathPrimitive {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const [first] = points;
  return {
    kind: 'path',
    x: round(first?.[0] ?? 0),
    y: round(first?.[1] ?? 0),
    d: `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`).join('')}Z`,
    fill: true,
    thickness: 0,
    bbox: rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top),
    role: 'ink',
    ...(node !== undefined && { node }),
  };
}

/**
 * A tie or slur: a crescent from (x1, y) to (x2, y) bulging `height` px up (negative) or down,
 * `thickness` px thick at its middle and pointed at the ends.
 */
export function arc(
  x1: number,
  x2: number,
  y: number,
  height: number,
  thickness: number,
  node?: Id,
): PathPrimitive {
  // A cubic whose control points sit 4/3 of the way out peaks at exactly `height`.
  const outer = y + (height * 4) / 3;
  const inner = y + ((height - Math.sign(height) * thickness) * 4) / 3;
  const a = x1 + (x2 - x1) / 4;
  const b = x2 - (x2 - x1) / 4;
  const d =
    `M${f(x1)} ${f(y)}C${f(a)} ${f(outer)} ${f(b)} ${f(outer)} ${f(x2)} ${f(y)}` +
    `C${f(b)} ${f(inner)} ${f(a)} ${f(inner)} ${f(x1)} ${f(y)}Z`;
  const top = Math.min(y, y + height);
  return {
    kind: 'path',
    x: round(x1),
    y: round(y),
    d,
    fill: true,
    thickness: 0,
    bbox: rect(x1, top, x2 - x1, Math.abs(height)),
    role: 'ink',
    ...(node !== undefined && { node }),
  };
}
