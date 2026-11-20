import type { Page } from '@playwright/test';

import { expect, test } from '../player/test/app';
import { generated } from '../player/test/scores';

// #337: the score's menus in edit mode. A right-click places the cursor as a click would, the
// menu holds the editing commands of what it opened on, and the levels above become submenus.
test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

const fretNumbers = (page: Page) =>
  page.locator('svg[data-system-id] text').filter({ hasText: /^\d+$/ });

/** A right-click on the middle of a fret number: the painter's text lies under the hit layer, so the press goes by position. */
async function rightClickNote(page: Page, index: number): Promise<void> {
  const box = await fretNumbers(page).nth(index).boundingBox();
  if (!box) throw new Error('no fret number to click');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
}

test('"Edit here" on a note switches to edit mode with the cursor on that note', async ({
  page,
}) => {
  await rightClickNote(page, 4);
  const menu = page.getByRole('menu', { name: /^Note, bar \d+$/ });
  await menu.getByRole('menuitem', { name: /^Edit here/ }).click();
  await expect(page.getByTestId('edit-status')).toBeVisible();
  // The fifth fret number of the song is on bar 1, beat 4 of the first track, on string 4.
  await expect(page.getByTestId('edit-status')).toContainText('Bar 1 · Beat 4 · String 4');
});

test('in edit mode a right-click on a note offers Delete note, and the Bar level is a submenu', async ({
  page,
}) => {
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('edit-status')).toBeVisible();
  const before = await fretNumbers(page).count();
  await rightClickNote(page, 4);
  const menu = page.getByRole('menu', { name: /^Note, bar \d+$/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bar' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Beat' })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Delete note/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(fretNumbers(page)).toHaveCount(before - 1);
});

test('the Menu key opens the cursor’s menu in edit mode, and Escape gives focus back', async ({
  app,
  page,
}) => {
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('edit-status')).toBeVisible();
  await app.score().focus();
  await page.keyboard.press('ContextMenu');
  const menu = page.getByRole('menu', { name: /^(Note|Beat|Bar)\b/ });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  // Only edit mode has editing commands in the menu.
  await expect(menu.locator('[data-command^="editor."]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(app.score()).toBeFocused();
});
