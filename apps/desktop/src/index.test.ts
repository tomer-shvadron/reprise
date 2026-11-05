import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@reprise/desktop', () => {
  it('exposes its root export', () => {
    expect(packageName).toBe('@reprise/desktop');
  });
});
