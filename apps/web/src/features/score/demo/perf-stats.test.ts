import { describe, expect, it } from 'vitest';

import { frameStats, median } from './perf-stats';

describe('perf statistics', () => {
  it('takes the median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNaN();
  });

  it('summarises frame intervals', () => {
    const intervals = [...Array.from({ length: 95 }, () => 16), 18, 18, 18, 25, 40];
    expect(frameStats(intervals)).toEqual({
      frames: 100,
      meanFps: (100 * 1000) / (95 * 16 + 3 * 18 + 25 + 40),
      p95Ms: 18,
      over20Ms: 2,
    });
  });
});
