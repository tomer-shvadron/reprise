import { describe, expect, it } from 'vitest';

import { bpmFor, parseBpm, percentForBpm, percentOf, stepPercent } from './tempo';

describe('tempo math', () => {
  it('turns a BPM into a percent of the written tempo, clamped to 25–200%', () => {
    expect(percentForBpm(90, 120)).toBe(75);
    expect(percentForBpm(10, 120)).toBe(25);
    expect(percentForBpm(500, 120)).toBe(200);
    expect(bpmFor(75, 160)).toBe(120);
  });

  it('steps on the 5% grid and stops at the bounds', () => {
    expect(stepPercent(77, -1)).toBe(75);
    expect(stepPercent(77, 1)).toBe(80);
    expect(stepPercent(100, 1)).toBe(105);
    expect(stepPercent(25, -1)).toBe(25);
    expect(stepPercent(200, 1)).toBe(200);
  });

  it('parses a BPM and rejects the rest', () => {
    expect(parseBpm(' 90 ')).toBe(90);
    expect(parseBpm('92.5')).toBe(92.5);
    for (const text of ['', 'abc', '0', '1000', '-5']) expect(parseBpm(text)).toBeUndefined();
  });

  it('reads either tempo mode as a percent', () => {
    expect(percentOf({ mode: 'percent', value: 80 }, 120)).toBe(80);
    expect(percentOf({ mode: 'bpm', value: 90 }, 120)).toBe(75);
  });
});
