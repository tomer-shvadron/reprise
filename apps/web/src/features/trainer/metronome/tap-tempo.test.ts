import { describe, expect, it } from 'vitest';

import { addTap, clampClickBpm, tapBpm } from './tap-tempo';

const tapsAt = (times: number[]) => times.reduce<number[]>((taps, time) => addTap(taps, time), []);

describe('tap tempo', () => {
  it('needs two taps, then reads the average gap', () => {
    expect(tapBpm(tapsAt([0]))).toBeUndefined();
    expect(tapBpm(tapsAt([0, 500]))).toBe(120);
    expect(tapBpm(tapsAt([0, 500, 1000, 1500]))).toBe(120);
    expect(tapBpm(tapsAt([0, 600, 1200]))).toBe(100);
  });

  it('starts over after a long pause', () => {
    expect(tapsAt([0, 500, 5000])).toEqual([5000]);
    expect(tapBpm(tapsAt([0, 500, 5000, 5400]))).toBe(150);
  });

  it('averages only the latest taps', () => {
    const slow = Array.from({ length: 8 }, (_, i) => i * 1000);
    const fast = Array.from({ length: 8 }, (_, i) => 8000 + i * 500);
    expect(tapBpm(tapsAt([...slow, ...fast]))).toBe(120);
  });

  it('stays inside the click range', () => {
    expect(tapBpm(tapsAt([0, 50]))).toBe(600);
    expect(tapBpm(tapsAt([0, 1900]))).toBe(32);
    expect(clampClickBpm(5)).toBe(10);
    expect(clampClickBpm(900)).toBe(600);
  });
});
