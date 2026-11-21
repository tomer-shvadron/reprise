import { expect, test } from './test/app';
import { generated } from './test/scores';

// #337: the status bar's segments have context menus. The segment's own click action stays.
test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

const zoom = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Status' }).getByRole('button', { name: /^\d+%$/ });

test('the zoom segment menu zooms in', async ({ page }) => {
  const segment = zoom(page);
  const before = await segment.textContent();
  await segment.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Zoom' });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
  await menu.getByRole('menuitem', { name: /^Zoom in/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(segment).not.toHaveText(before ?? '');
});

test('choosing a segment menu item with Space runs only that item, and focus returns', async ({
  page,
}) => {
  const segment = zoom(page);
  const before = Number.parseInt((await segment.textContent()) ?? '', 10);
  await segment.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Zoom' });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  await expect(menu.getByRole('menuitem', { name: /^Zoom in/ })).toBeFocused();
  await page.keyboard.press('Space');
  // No menu at all: neither the context menu nor the segment's own dropdown the press could open.
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Exactly one zoom step (100% to 110%), so the segment's own action did not also run.
  expect(before).toBe(100);
  await expect(segment).toHaveText('110%');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(segment).toBeFocused();
});

test('the Saved segment menu offers Save, Save as and Export', async ({ page }) => {
  await page
    .getByRole('region', { name: 'Status' })
    .getByRole('button', { name: /^(Saved|Unsaved)/ })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Saved' });
  await expect(menu.getByRole('menuitem', { name: /^Save as/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Export/ })).toBeVisible();
  await page.keyboard.press('Escape');
});
