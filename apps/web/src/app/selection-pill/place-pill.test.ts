import { describe, expect, it } from 'vitest';

import { placePill } from './place-pill';

const size = { width: 200, height: 28 };
const visible = { x: 0, y: 0, width: 1000, height: 600 };
const part = (x: number, y: number, width: number, height: number) => ({
  box: { x, y, width, height },
});

describe('placePill', () => {
  it('sits above the selection, centred on it', () => {
    expect(placePill({ parts: [part(400, 200, 200, 100)], size, visible })).toEqual({
      x: 400,
      y: 200 - 6 - 28,
      side: 'above',
    });
  });

  it('flips below when above would cover the staff above', () => {
    const parts = [
      { ...part(400, 200, 200, 100), above: { x: 0, y: 150, width: 1000, height: 40 } },
    ];
    expect(placePill({ parts, size, visible })).toEqual({ x: 400, y: 306, side: 'below' });
  });

  it('stays above a staff it does not reach', () => {
    const parts = [
      { ...part(400, 200, 200, 100), above: { x: 0, y: 100, width: 1000, height: 40 } },
    ];
    expect(placePill({ parts, size, visible })?.side).toBe('above');
  });

  it('flips below at the top edge of the window', () => {
    expect(placePill({ parts: [part(400, 20, 200, 100)], size, visible })).toEqual({
      x: 400,
      y: 126,
      side: 'below',
    });
  });

  it('stays above, clamped into the window, when neither side fits', () => {
    const placed = placePill({ parts: [part(400, 10, 200, 590)], size, visible });
    expect(placed).toEqual({ x: 400, y: 0, side: 'above' });
  });

  it('clamps horizontally at both edges, with the margin', () => {
    expect(placePill({ parts: [part(0, 200, 40, 100)], size, visible })?.x).toBe(8);
    expect(placePill({ parts: [part(960, 200, 40, 100)], size, visible })?.x).toBe(1000 - 8 - 200);
  });

  it('centres on the visible width of a selection wider than the window', () => {
    const placed = placePill({ parts: [part(-500, 200, 3000, 100)], size, visible });
    expect(placed?.x).toBe(400);
  });

  it('takes the first part that is in view', () => {
    const parts = [part(0, -900, 400, 100), part(0, 300, 400, 100), part(0, 450, 400, 100)];
    const placed = placePill({ parts, size, visible });
    expect(placed?.y).toBe(300 - 6 - 28);
  });

  it('is undefined when no part is in view', () => {
    expect(placePill({ parts: [part(0, 1200, 400, 100)], size, visible })).toBeUndefined();
    expect(placePill({ parts: [], size, visible })).toBeUndefined();
  });

  it('respects a window shortened by the bottom inset', () => {
    const shortened = { ...visible, height: 300 };
    // Below would end at 306 + 28 = 334, past the inset: stays above, which fits.
    const placed = placePill({
      parts: [{ ...part(400, 200, 200, 100), above: { x: 0, y: 150, width: 1000, height: 40 } }],
      size,
      visible: shortened,
    });
    expect(placed).toEqual({ x: 400, y: 166, side: 'above' });
  });
});
