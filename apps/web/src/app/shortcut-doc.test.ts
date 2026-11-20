import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-relative-packages -- a doc file, not code: the root package exports nothing to import it through
import doc from '../../../../docs/reference/keyboard-shortcuts.md?raw';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { SHORTCUT_OVERRIDES_SETTING } from './keymap';
import { shortcutTable } from './shortcut-table';

const TABLE = /(<!-- shortcuts:start -->\r?\n)[\s\S]*?(\r?\n<!-- shortcuts:end -->)/;

describe('docs/reference/keyboard-shortcuts.md', () => {
  const registry = createAppRegistry(createTestServices());

  // The file snapshot makes `pnpm shortcuts:write` (vitest -u) rewrite the doc, and a plain run
  // fail on any difference, so the table cannot drift from the registry.
  it('matches the command registry', async () => {
    // Without the markers the replace below would change nothing and the snapshot would compare
    // the file with itself.
    expect(doc).toMatch(TABLE);
    expect(doc).not.toContain('\r');
    // The Guitar Pro defaults by construction, not because the services happen to be fresh.
    const table = shortcutTable(registry.list(), (command) => command.shortcut);
    await expect(
      doc.replace(TABLE, (_all, start: string, end: string) => start + table + end),
    ).toMatchFileSnapshot('../../../../docs/reference/keyboard-shortcuts.md');
  });

  it('stays on the defaults when the user has overrides', () => {
    const services = createTestServices();
    const changed = createAppRegistry(services, 'mac');
    services.settings.set(SHORTCUT_OVERRIDES_SETTING, { 'view.toggleViewMode': { key: 'F5' } });
    const [command] = changed.list();
    expect(command && changed.shortcutOf(command)).toBeDefined();
    expect(shortcutTable(changed.list(), (c) => c.shortcut)).toBe(
      shortcutTable(registry.list(), (c) => c.shortcut),
    );
  });

  it('binds no key twice in one context, on either platform (as declared)', () => {
    expect(registry.conflicts()).toEqual([]);
  });
});
