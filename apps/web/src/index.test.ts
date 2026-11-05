import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@reprise/web', () => {
  it('exposes its root export', () => {
    expect(packageName).toBe('@reprise/web');
  });

  it('runs with a DOM', () => {
    const element = document.createElement('div');
    element.textContent = 'reprise';
    document.body.append(element);

    expect(document.body.textContent).toContain('reprise');
  });
});
