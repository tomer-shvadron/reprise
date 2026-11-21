import type { Page } from '@playwright/test';

import { expect, test, type App } from './test/app';
import { generated, libraryFile } from './test/scores';

// #337: the library's song rows and the sound manager's pack rows have context menus, over the
// modal sheets. The sheet stays open under the menu.
const songs = (page: Page) => page.getByRole('listbox', { name: 'Songs' }).getByRole('option');

async function importTwoSongs(app: App): Promise<void> {
  for (const n of [1, 2]) {
    await app.stage(generated(libraryFile(n)), libraryFile(n));
    await app.pick(libraryFile(n));
  }
  await app.palette('Import files to library');
  await expect(songs(app.page)).toHaveCount(2);
}

test('a song row menu opens over the sheet, deletes after confirming and returns focus', async ({
  app,
  page,
}) => {
  await app.gesture();
  await importTwoSongs(app);
  const first = songs(page).first();
  const title = (await first.locator('span').first().textContent()) ?? '';

  await first.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `Song ${title}` });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
  await expect(menu.getByRole('menuitem', { name: /^Open/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Practice log/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Delete from library/ }).click();

  const confirm = page.getByRole('dialog', { name: /^Delete/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  // The sheet was never closed by the menu or the dialog, and focus is back where it was before
  // the right-click (the search box the sheet opened on).
  await expect(page.getByRole('dialog', { name: 'Library', exact: true })).toBeVisible();
  await expect(songs(page)).toHaveCount(2);
  await expect(page.getByRole('searchbox', { name: 'Search songs' })).toBeFocused();

  await page.getByRole('listbox', { name: 'Songs' }).focus();
  await page.keyboard.press('Shift+F10');
  const keyed = page.getByRole('menu', { name: /^Song / });
  await expect(keyed).toHaveAttribute('data-context-menu-via', 'keyboard');
  await expect(keyed.getByRole('menuitem', { name: /^Open/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('listbox', { name: 'Songs' })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Library', exact: true })).toBeVisible();

  await first.click({ button: 'right' });
  await page
    .getByRole('menu', { name: /^Song / })
    .getByRole('menuitem', { name: /^Delete from library/ })
    .click();
  await page
    .getByRole('dialog', { name: /^Delete/ })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(songs(page)).toHaveCount(1);
});

test('a sound pack row menu opens over the Sounds sheet without closing it', async ({
  app,
  page,
}) => {
  await app.palette('Show sound manager');
  const sheet = page.getByRole('dialog', { name: 'Sounds', exact: true });
  await expect(sheet).toBeVisible();
  const row = sheet.locator('[data-pack-id]').first();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^Sound pack / });
  await expect(menu.getByRole('menuitem', { name: /^Open download page/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(sheet).toBeVisible();
});
