import { describe, expect, it } from 'vitest';

import { outputLatencyOf } from './output-latency';

describe('outputLatencyOf', () => {
  it('adds baseLatency and outputLatency, each where reported', () => {
    expect(outputLatencyOf({ outputLatency: 0.032, baseLatency: 0.005 })).toBeCloseTo(0.037, 9);
    expect(outputLatencyOf({ outputLatency: 0, baseLatency: 0.005 })).toBe(0.005);
    expect(outputLatencyOf({ baseLatency: 0.01 })).toBe(0.01);
    expect(outputLatencyOf({})).toBe(0);
    expect(outputLatencyOf(undefined)).toBe(0);
  });
});
