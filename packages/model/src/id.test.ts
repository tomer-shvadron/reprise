import { describe, expect, it } from 'vitest';

import { ID_LENGTH, ID_PATTERN, IdSchema, newId } from './id';

describe('newId', () => {
  it('produces 12 base62 characters', () => {
    const id = newId();
    expect(id).toHaveLength(ID_LENGTH);
    expect(id).toMatch(ID_PATTERN);
    expect(IdSchema.safeParse(id).success).toBe(true);
  });

  it('is unique and draws on the whole alphabet over a large sample', () => {
    const sample = 100_000;
    const ids = new Set<string>();
    const characters = new Set<string>();
    for (let i = 0; i < sample; i++) {
      const id = newId();
      expect(id).toMatch(ID_PATTERN);
      ids.add(id);
      for (const character of id) characters.add(character);
    }
    expect(ids.size).toBe(sample);
    expect(characters.size).toBe(62);
  });

  it('is rejected by the schema when malformed', () => {
    expect(IdSchema.safeParse('short').success).toBe(false);
    expect(IdSchema.safeParse('abcdefghijk-').success).toBe(false);
  });
});
