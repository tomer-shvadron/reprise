import { describe, expect, it } from 'vitest';

import { ID_LENGTH, ID_PATTERN, IdSchema, newId } from './id';

describe('newId', () => {
  it('produces 12 base62 characters', () => {
    const id = newId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(id).toMatch(ID_PATTERN);
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it('is unique and draws evenly on the whole alphabet over a large sample', () => {
    const sample = 100_000;
    const ids = new Set<string>();
    const counts = new Map<string, number>();
    for (let i = 0; i < sample; i++) {
      const id = newId();
      expect(id).toMatch(ID_PATTERN);
      ids.add(id);
      for (const character of id) counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    expect(ids.size).toBe(sample);
    expect(counts.size).toBe(62);
    // Seven standard deviations either side; a biased modulo would put the first eight
    // characters about 20% high.
    const expected = (sample * ID_LENGTH) / 62;
    for (const count of counts.values()) {
      expect(Math.abs(count - expected)).toBeLessThan(expected * 0.05);
    }
  });

  // Loose on purpose: one `getRandomValues` call per id took about 80 ms here, so this catches
  // only a gross regression, and a slow CI box must not fail it.
  it('makes 100k ids well under a second', () => {
    const start = Date.now();
    for (let i = 0; i < 100_000; i++) newId();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('is rejected by the schema when malformed', () => {
    expect(IdSchema.safeParse('short').success).toBe(false);
    expect(IdSchema.safeParse('abcdefghijk-').success).toBe(false);
  });
});
