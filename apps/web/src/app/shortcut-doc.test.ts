import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-relative-packages -- a doc file, not code: the root package exports nothing to import it through
import doc from '../../../../docs/reference/keyboard-shortcuts.md?raw';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { shortcutTable } from './shortcut-table';

describe('docs/reference/keyboard-shortcuts.md', () => {
  it('matches the command registry', () => {
    const expected = shortcutTable(createAppRegistry(createTestServices()).list());
    const table = /<!-- shortcuts:start -->\n([\s\S]*?)\n<!-- shortcuts:end -->/.exec(doc)?.[1];
    expect(table, `Paste this table into the doc:\n${expected}`).toBe(expected);
  });
});
