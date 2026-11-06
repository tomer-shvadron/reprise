import { note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type StaffType } from '../index';
import type { StaffModule } from './staff-module';

interface Seen {
  staff: StaffType;
  barIndex: number;
  system: number;
  staves: readonly StaffType[];
  x: number;
  width: number;
  first: number;
  previous: number | undefined;
  next: number | undefined;
}

const { seen } = vi.hoisted(() => {
  const seen: Seen[] = [];
  return { seen };
});

vi.mock(import('./index'), async (importOriginal) => {
  const original = await importOriginal();
  const recording = (module: StaffModule): StaffModule => ({
    ...module,
    render(input, placement, sink) {
      seen.push({
        staff: module.type,
        barIndex: input.barIndex,
        system: placement.system,
        staves: input.staves,
        x: placement.x,
        width: placement.width,
        first: placement.onsetX(0),
        previous: placement.previous?.onsetX(0),
        next: placement.next?.onsetX(0),
      });
      module.render(input, placement, sink);
    },
  });
  return {
    ...original,
    staffModule: (type, display) => recording(original.staffModule(type, display)),
  };
});

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

describe('what a staff module is given', () => {
  const builder = score().track('guitar', { display: { notation: 'both', octaveShift: 1 } });
  for (let b = 0; b < 6; b++) {
    builder.bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [note(1, i)]);
  }
  const built = builder.build({ ids: 'sequential' });

  it('names the track staves and the neighbouring bars of the system', () => {
    seen.length = 0;
    const result = layout(built, paged);
    expect(result.systems.length).toBeGreaterThan(1);
    expect(seen).toHaveLength(12);
    for (const call of seen) expect(call.staves).toEqual(['standard', 'tab']);

    for (const staff of ['standard', 'tab'] as const) {
      const calls = seen.filter((call) => call.staff === staff);
      for (const [i, call] of calls.entries()) {
        const before = calls[i - 1];
        const after = calls[i + 1];
        const opensSystem = before === undefined || before.system !== call.system;
        const endsSystem = after === undefined || after.system !== call.system;
        expect(call.previous, `bar ${String(call.barIndex)} previous`).toBe(
          opensSystem ? undefined : before.first,
        );
        expect(call.next, `bar ${String(call.barIndex)} next`).toBe(
          endsSystem ? undefined : after.first,
        );
        if (!endsSystem) expect(after.x).toBeGreaterThanOrEqual(call.x + call.width);
      }
    }
  });
});
