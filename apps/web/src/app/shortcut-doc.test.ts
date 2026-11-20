import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-relative-packages -- a doc file, not code: the root package exports nothing to import it through
import doc from '../../../../docs/reference/keyboard-shortcuts.md?raw';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { shortcutId } from './keyboard';
import { shortcutTable } from './shortcut-table';

const TABLE = /(<!-- shortcuts:start -->\n)[\s\S]*?(\n<!-- shortcuts:end -->)/;

describe('docs/reference/keyboard-shortcuts.md', () => {
  const registry = createAppRegistry(createTestServices());

  // The file snapshot makes `pnpm shortcuts:write` (vitest -u) rewrite the doc, and a plain run
  // fail on any difference, so the table cannot drift from the registry.
  it('matches the command registry', async () => {
    const table = shortcutTable(registry.list(), (command) => registry.shortcutOf(command));
    await expect(
      doc.replace(TABLE, (_all, start: string, end: string) => start + table + end),
    ).toMatchFileSnapshot('../../../../docs/reference/keyboard-shortcuts.md');
  });

  it('binds no key twice in one context, on either platform', () => {
    const seen = new Map<string, string>();
    for (const command of registry.list()) {
      const shortcut = registry.shortcutOf(command);
      if (!shortcut) continue;
      for (const platform of ['mac', 'other'] as const) {
        if ((shortcut.only ?? platform) !== platform) continue;
        const binding = `${platform}:${command.context ?? 'global'}:${shortcutId(shortcut)}`;
        expect(seen.get(binding), `${binding} is bound twice`).toBeUndefined();
        seen.set(binding, command.id);
      }
    }
  });
});
