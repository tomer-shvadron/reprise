import { describe, expect, it } from 'vitest';

import { ScoreSchema, createEmptyScore, newId, tieChainOf, validateScore } from './index';

describe('@reprise/model public API', () => {
  it('builds, validates and checks a score through the root export', () => {
    const score = createEmptyScore();
    expect(ScoreSchema.safeParse(score).success).toBe(true);
    expect(validateScore(score)).toEqual([]);
    expect(newId()).toHaveLength(12);
  });

  it('exports the tie chain walk', () => {
    expect(tieChainOf).toBeTypeOf('function');
  });
});
