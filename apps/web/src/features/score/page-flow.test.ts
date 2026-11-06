import { describe, expect, it } from 'vitest';

import { pageAt, pageFlow, systemShift, toLayoutY, toViewRect } from './page-flow';
import { viewLayout } from './test/small-score';

const a4 = { mode: 'paged', paper: 'a4' } as const;
const bottom = (rect: { y: number; height: number }) => rect.y + rect.height;

describe('pageFlow', () => {
  it('leaves a layout whose systems fit their pages as it is', () => {
    const result = viewLayout('small', a4);
    const flow = pageFlow(result);
    expect(flow.pages).toBe(result.pages);
    expect(flow.systems).toBe(result.systems);
    expect(flow.shifts.every((shift) => shift === 0)).toBe(true);
  });

  it('grows a page to hold a taller system and moves the later pages down', () => {
    const result = viewLayout('tall', a4, 'both');
    const flow = pageFlow(result);
    const gap = (result.pages[1]?.bbox.y ?? 0) - bottom(result.pages[0]?.bbox ?? never());
    expect(
      result.systems.every((s) => s.bbox.height > (result.pages[s.page]?.bbox.height ?? 0)),
    ).toBe(true);
    flow.pages.forEach((page, index) => {
      const systems = flow.systems.filter((system) => system.page === index);
      // The flow adds shifts to rounded coordinates, so equal bottoms can differ in the last bit.
      for (const system of systems)
        expect(bottom(system.bbox) - bottom(page.bbox)).toBeLessThan(1e-9);
      const next = flow.pages[index + 1];
      if (next) expect(next.bbox.y).toBeCloseTo(bottom(page.bbox) + gap);
    });
    expect(flow.shifts[0]).toBe(0);
    expect(flow.shifts[2]).toBeGreaterThan(flow.shifts[1] ?? 0);
  });

  it('maps between layout and view px by page', () => {
    const result = viewLayout('tall', a4, 'both');
    const flow = pageFlow(result);
    const system = result.systems[1] ?? never();
    const shift = systemShift(flow, result, 1);
    expect(shift).toBe(flow.shifts[1]);
    const near = { x: 10, y: system.bbox.y + 20, width: 5, height: 5 };
    expect(toViewRect(flow, result, near).y).toBe(near.y + shift);
    // Below its page's end, an overflowing system's rect needs the system to place it.
    const overflow = { ...near, y: bottom(system.bbox) - 20 };
    expect(toViewRect(flow, result, overflow, 1).y).toBe(overflow.y + shift);
    expect(pageAt(flow, overflow.y + shift)?.index).toBe(1);
    expect(toLayoutY(flow, { x: 10, y: overflow.y + shift }).point.y).toBe(overflow.y);
  });
});

function never(): never {
  throw new Error('missing fixture data');
}
