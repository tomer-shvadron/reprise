import { describe, it } from 'vitest';

import { CACHE_PROPERTY_MODES, checkCachedEqualsCold } from './test/cache-property';

// The test names match the single cache-property.test.ts they were split from; see the helper.
describe('LayoutCache: random edits', () => {
  it.each(
    CACHE_PROPERTY_MODES.map(([label, mode, height]) => ['both', label, mode, height] as const),
  )(
    'keeps cached equal to cold in %s notation, %s',
    (notation, _label, mode, height) => {
      checkCachedEqualsCold(notation, mode, height);
    },
    // 16.2 s worst on CI (#384): own timeout, 4x the worst rounded up to 120 s.
    120_000,
  );
});
