import { describe, expect, it } from 'vitest';

import { soundTierLabel } from './sound-tier';

describe('soundTierLabel', () => {
  it('is GM for no tracks and for tracks with no entry', () => {
    expect(soundTierLabel([], {})).toBe('GM');
    expect(soundTierLabel(['a', 'b'], {})).toBe('GM');
  });

  it('is HQ when every track plays a pack, and GM + HQ when it is mixed', () => {
    expect(soundTierLabel(['a'], { a: { tier: 'hq', packId: 'p' } })).toBe('HQ');
    expect(soundTierLabel(['a', 'b'], { a: { tier: 'hq', packId: 'p' } })).toBe('GM + HQ');
  });

  it('counts a track whose pack is missing as GM', () => {
    expect(soundTierLabel(['a'], { a: { tier: 'gm', packId: 'p', problem: 'missing' } })).toBe(
      'GM',
    );
  });
});
