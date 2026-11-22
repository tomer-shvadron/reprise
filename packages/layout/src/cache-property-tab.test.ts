import { describe, it } from 'vitest';

import { CACHE_PROPERTY_MODES, checkCachedEqualsCold } from './test/cache-property';

// The test names match the single cache-property.test.ts they were split from; see the helper.
describe('LayoutCache: random edits', () => {
  it.each(
    CACHE_PROPERTY_MODES.map(([label, mode, height]) => ['tab', label, mode, height] as const),
  )(
    'keeps cached equal to cold in %s notation, %s',
    (notation, _label, mode, height) => {
      checkCachedEqualsCold(notation, mode, height);
    },
    60_000,
  );

  it('keeps cached equal to cold in tab notation, continuous, with verticalReach (#229)', () => {
    checkCachedEqualsCold('tab', 'continuous', undefined, true);
  }, 60_000);
});
