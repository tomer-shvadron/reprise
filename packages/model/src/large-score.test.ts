import { describe, expect, it } from 'vitest';

import { ScoreSchema } from './score';
import { largeScore } from './testing';
import { validateScore } from './validate';

// Date.now() because the package's lib has no `performance`; millisecond resolution is enough.
function timed<T>(run: () => T): [T, number] {
  const start = Date.now();
  const result = run();
  return [result, Date.now() - start];
}

// Validate, parse and stringify measured 22 to 25, 74 to 76 and 12 to 14 ms alone, and up to 310,
// 693 and 264 ms under three parallel runs; the bounds only catch a quadratic regression.
describe('a large score', () => {
  const score = largeScore(8, 300);

  it('validates in linear time', { timeout: 30_000 }, () => {
    const [violations, ms] = timed(() => validateScore(score));
    expect(violations).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it('round-trips through JSON and the schema', { timeout: 30_000 }, () => {
    const [json, stringifyMs] = timed(() => JSON.stringify(score));
    const [parsed, parseMs] = timed(() => ScoreSchema.parse(JSON.parse(json)));
    expect(parsed).toEqual(score);
    expect(stringifyMs).toBeLessThan(1000);
    expect(parseMs).toBeLessThan(5_000);
  });
});
