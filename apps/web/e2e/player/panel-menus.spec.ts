import { expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('a track row menu mutes its track, and offers no track management in play mode', async ({
  page,
}) => {
  const row = page.getByRole('list', { name: 'Tracks' }).getByRole('listitem').first();
  await row.getByRole('button', { name: /^Mute / }).waitFor();
  await row.locator('[data-track-number]').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^Track / });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
  await expect(menu.getByRole('menuitem', { name: /^Remove track/ })).toHaveCount(0);
  await menu.getByRole('menuitemcheckbox', { name: /^Mute/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(row.getByRole('button', { name: /^Mute / })).toHaveAttribute('aria-pressed', 'true');
});

test('edit mode adds the track management to the row menu', async ({ app, page }) => {
  await app.palette('Edit mode');
  const row = page.getByRole('list', { name: 'Tracks' }).getByRole('listitem').first();
  await row.locator('[data-track-number]').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^Track / });
  await expect(menu.getByRole('menuitem', { name: /^Remove track/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Move track down/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the loop button has a menu whose Loop item is a checkbox', async ({ page }) => {
  const loop = page.getByRole('button', { name: 'Loop', exact: true });
  await loop.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Loop' });
  await menu.getByRole('menuitemcheckbox', { name: /^Loop/ }).click();
  await expect(page.getByRole('button', { name: /^Loop bars / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the fretboard tab menu flips the board for a left-handed player', async ({ app, page }) => {
  await app.palette('Toggle fretboard');
  const board = page.locator('[data-fretboard]');
  await expect(board).toHaveAttribute('data-left-handed', 'false');
  await page.getByRole('tab', { name: 'Fretboard' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Fretboard tab' });
  await menu.getByRole('menuitemcheckbox', { name: /^Left-handed fretboard/ }).click();
  await expect(board).toHaveAttribute('data-left-handed', 'true');
});

test('the Fretboard tab opens its menu from the keyboard, and Escape gives focus back', async ({
  app,
  page,
}) => {
  await app.palette('Toggle fretboard');
  const tab = page.getByRole('tab', { name: 'Fretboard' });
  await tab.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Fretboard tab' });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  await expect(menu.getByRole('menuitem', { name: /^Close fretboard/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(tab).toBeFocused();
});
