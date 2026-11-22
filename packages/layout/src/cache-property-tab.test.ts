import { describe, it } from 'vitest';

import {
  CACHE_PROPERTY_MODES,
  checkCachedEqualsCold,
  checkJumpOverStructure,
} from './test/cache-property';

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

  it.each(['paged', 'continuous'] as const)(
    'keeps cached equal to cold across a jump over bar, track and score edits, %s',
    (mode) => {
      checkJumpOverStructure('tab', mode);
    },
    60_000,
  );
});
