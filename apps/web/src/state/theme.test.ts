import { describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';
import { THEME_STORAGE_KEY } from './theme';

describe('theme bootstrap in index.html', () => {
  it('reads the same storage key as the store, before the app script loads', () => {
    const read = indexHtml.indexOf(`localStorage.getItem('${THEME_STORAGE_KEY}')`);

    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(indexHtml.indexOf('src="/src/main.tsx"'));
  });

  it('starts dark, matching the stylesheet default until the script runs', () => {
    expect(indexHtml).toContain('<html lang="en" data-theme="dark">');
  });
});
