import { describe, expect, it, vi } from 'vitest';

import { play, stubFollowEnvironment, trackAt } from './test/follow-long';
import { longLayout } from './test/long-score';

vi.mock('./fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

stubFollowEnvironment();

describe('following the long score', () => {
  it('splits every A4 system, with tracks 1 to 5 in its first part and 6 to 8 in its second', () => {
    const { systems } = longLayout({ mode: 'paged', paper: 'a4' });
    const partOf = (track: number) =>
      systems.find((system) => system.staves.some((staff) => staff.track === trackAt(track)))?.part;
    expect(systems.every((system) => system.part !== undefined)).toBe(true);
    expect([0, 4, 5, 7].map(partOf)).toEqual([0, 0, 1, 1]);
  });

  // Track 1 sits in the first part of each split A4 system, tracks 6 and 8 in the second.
  const mode = 'paged';
  for (const zoom of [1, 2]) {
    for (const index of [0, 5, 7]) {
      it(`keeps the playhead in view following track ${String(index + 1)}, ${mode} at zoom ${String(zoom)}`, () => {
        const track = trackAt(index);
        expect(play(mode, zoom, false, track)).toEqual([]);
        expect(play(mode, zoom, true, track)).toEqual([]);
      }, 60_000);
    }
  }
});
