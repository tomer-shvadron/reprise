import { describe, expect, it } from 'vitest';

import { arc } from './shapes';

/** The outer curve of a slanted arc, sampled from its path's first cubic. */
function sampled(d: string): number[] {
  const numbers = d.slice(1, d.indexOf('C', d.indexOf('C') + 1)).match(/-?\d+(\.\d+)?/g);
  const [, y0, , y1, , y2, , y3] = (numbers ?? []).map(Number);
  if (y0 === undefined || y1 === undefined || y2 === undefined || y3 === undefined) return [];
  return Array.from({ length: 1001 }, (_, i) => {
    const t = i / 1000;
    const u = 1 - t;
    return u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
  });
}

describe('arc', () => {
  it('bounds a slanted arc by its outer curve, which peaks past the midpoint', () => {
    for (const [y1, y2, height] of [
      [100, 110, -5],
      [100, 90, -5],
      [100, 110, 5],
      [100, 130, -5],
    ] as const) {
      const shape = arc(10, 60, y1, height, 1, undefined, y2);
      const ys = sampled(shape.d);
      expect(shape.bbox.y).toBeCloseTo(Math.min(...ys), 1);
      expect(shape.bbox.y + shape.bbox.height).toBeCloseTo(Math.max(...ys), 1);
    }
  });
});
