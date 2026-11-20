import { describe, expect, it, vi } from 'vitest';

import { play, stubFollowEnvironment, trackAt } from './test/follow-long';

vi.mock('./fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

stubFollowEnvironment();

describe('following the long score', () => {
  // Track 1 sits in the first part of each split A4 system, tracks 6 and 8 in the second.
  const mode = 'continuous';
  for (const zoom of [1, 2]) {
    for (const index of [0, 7]) {
      it(`keeps the playhead in view following track ${String(index + 1)}, ${mode} at zoom ${String(zoom)}`, () => {
        const track = trackAt(index);
        expect(play(mode, zoom, false, track)).toEqual([]);
        expect(play(mode, zoom, true, track)).toEqual([]);
      }, 60_000);
    }
  }
});
