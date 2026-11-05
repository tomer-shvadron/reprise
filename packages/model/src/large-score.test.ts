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

// Measured at 15 to 26 ms, 67 ms and 12 ms; the bounds only catch a quadratic regression.
describe('a large score', () => {
  const score = largeScore(8, 300);

  it('validates in linear time', () => {
    const [violations, ms] = timed(() => validateScore(score));
    expect(violations).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it('round-trips through JSON and the schema', () => {
    const [json, stringifyMs] = timed(() => JSON.stringify(score));
    const [parsed, parseMs] = timed(() => ScoreSchema.parse(JSON.parse(json)));
    expect(parsed).toEqual(score);
    expect(stringifyMs).toBeLessThan(1000);
    expect(parseMs).toBeLessThan(2000);
  });
});
