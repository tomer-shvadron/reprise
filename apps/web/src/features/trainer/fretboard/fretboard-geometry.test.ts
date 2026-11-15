import { describe, expect, it } from 'vitest';

import { geometryOf } from './fretboard-geometry';

describe('geometryOf', () => {
  it.each([4, 6, 7])('spans the frets across all %i strings and fits the labels', (strings) => {
    const g = geometryOf({ strings, frets: 24, capo: 0 }, false);
    expect(g.wireTop).toBeLessThan(g.stringY(1));
    expect(g.wireBottom).toBeGreaterThan(g.stringY(strings));
    expect(g.wireBottom - g.stringY(strings)).toBe(g.stringY(1) - g.wireTop);
    // The fret numbers sit under the wires, inside the view.
    expect(g.wireBottom + 14).toBeLessThan(g.height);
  });

  it('mirrors x when left-handed and leaves y alone', () => {
    const board = { strings: 6, frets: 24, capo: 0 };
    const right = geometryOf(board, false);
    const left = geometryOf(board, true);
    expect(left.dotX(5)).toBeCloseTo(right.width - right.dotX(5));
    expect(left.stringY(3)).toBe(right.stringY(3));
  });
});
