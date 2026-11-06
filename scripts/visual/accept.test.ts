import { describe, expect, it } from 'vitest';

import { baselinePath } from './accept.ts';

const BASELINE =
  'apps/web/e2e/visual/__screenshots__/score.visual.test.tsx/rhythm-values-tab-dark-chromium-linux.png';

describe('baselinePath', () => {
  it('maps an actual image to its baseline', () => {
    expect(
      baselinePath(
        'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('maps the reference written for a missing baseline', () => {
    expect(
      baselinePath(
        'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-reference-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('strips a leading attachments directory', () => {
    expect(
      baselinePath(
        'apps/web/.vitest/attachments/e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('rejects diffs, other platforms and hashed attachments', () => {
    for (const path of [
      'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-diff-chromium-linux.png',
      'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-darwin.png',
      '86715f4e4cdc487c938a92f74d4e93210438df6c.png',
    ]) {
      expect(baselinePath(path)).toBeUndefined();
    }
  });
});
