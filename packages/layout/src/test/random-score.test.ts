import { describe, expect, it } from 'vitest';

import { randomScore } from './random-score';

const PINNED = [2147483622, 2001385099, 157889746, 80002139, 771020175];

describe('randomScore techniques', () => {
  it.each(PINNED)('keeps the pinned #141 seed %i free of golpe and pick scrape', (seed) => {
    expect(JSON.stringify(randomScore(seed))).not.toMatch(/golpe|pickScrape/);
  });

  it('adds them on request and changes nothing else', () => {
    let found = 0;
    for (const seed of PINNED) {
      const plain = JSON.stringify(randomScore(seed));
      const withTechniques = JSON.stringify(randomScore(seed, { techniques: true }));
      if (/golpe|pickScrape/.test(withTechniques)) found++;
      const stripped = withTechniques
        .replace(/"golpe":"(thumb|finger)",?/g, '')
        .replace(/"pickScrape":"(down|up)",?/g, '')
        .replace(/,}/g, '}');
      expect(stripped.replace(/"id":"[^"]*"/g, '')).toBe(plain.replace(/"id":"[^"]*"/g, ''));
    }
    expect(found).toBeGreaterThan(0);
  });
});
