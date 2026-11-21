import { centre, expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('the Menu key opens the focused control menu below it, and Escape gives focus back', async ({
  page,
}) => {
  const crumb = page.getByRole('banner').getByRole('button', { name: 'Library' });
  const anchor = await crumb.boundingBox();
  await crumb.focus();
  // Chromium raises the event itself, as a `PointerEvent` of type `mouse` with `button` -1: this
  // is what settles that a keyboard open is told from a pointer one by the missing press.
  await page.keyboard.press('ContextMenu');
  const menu = page.getByRole('menu', { name: 'Library' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  const shown = await menu.boundingBox();
  // Below the control's middle: the menu is still sliding in when it is measured.
  expect(shown?.y).toBeGreaterThan((anchor?.y ?? 0) + (anchor?.height ?? 0) / 2);
  expect(shown?.x).toBeCloseTo(anchor?.x ?? 0, -1);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(crumb).toBeFocused();
});

test('Shift+F10 opens the same menu', async ({ page }) => {
  const crumb = page.getByRole('banner').getByRole('button', { name: 'Library' });
  await crumb.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Library' });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  await page.keyboard.press('Escape');
  await expect(crumb).toBeFocused();
});

test('a right-click opens the menu at the pointer, and choosing leaves focus so Space plays', async ({
  app,
  page,
}) => {
  const view = page.getByRole('button', { name: 'View options' });
  await view.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'View' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
  await menu.getByRole('menuitem', { name: /^Zoom in/ }).click();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
});

test('a rail button has its own menu, which also folds the panel', async ({ page }) => {
  const rail = page.getByRole('group', { name: 'Panel rail' });
  await rail.getByRole('button', { name: 'History' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'History view' });
  await menu.getByRole('menuitem', { name: /^Show history/ }).click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

  await rail.getByRole('button', { name: 'History' }).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'History view' })
    .getByRole('menuitem', { name: 'Collapse panel' })
    .click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveCount(0);
});

test('a panel tab menu lists the tool actions of its view', async ({ page }) => {
  const rail = page.getByRole('group', { name: 'Panel rail' });
  await rail.getByRole('button', { name: 'Practice' }).click();
  await page.getByRole('tab', { name: 'Tuner' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Tuner tab' });
  await expect(menu.getByRole('menuitem', { name: /^Start or stop tuner/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Collapse panel' })).toBeVisible();
});

test('no editing command shows in a play-mode menu', async ({ page }) => {
  await page.getByRole('banner').click({ button: 'right', position: { x: 500, y: 14 } });
  const menu = page.getByRole('menu', { name: 'Header' });
  await expect(menu.getByRole('menuitem', { name: /^Show command palette/ })).toBeVisible();
  await expect(menu.locator('[data-command^="editor."]')).toHaveCount(0);
});

test('a right-click on a bar loops it without seeking, and Space still plays', async ({
  app,
  page,
}) => {
  const box = await app.barBox(3);
  const before = await app.field('time').textContent();
  const at = await app.toViewport(centre(box));
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: /bar 3$/i });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
  await expect(menu.getByRole('menuitem', { name: /^Edit here/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Loop this bar/ }).click();
  // In the transport: the selection pill over the bar has a Loop button of its own.
  await expect(
    page.getByRole('contentinfo', { name: 'Transport' }).getByRole('button', { name: /^Loop/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  // The playhead stayed where it was.
  await expect(app.field('time')).toHaveText(before ?? '');
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
});

test('the Menu key opens the score menu from the focused score, and from the page itself', async ({
  app,
  page,
}) => {
  await app.score().focus();
  await page.keyboard.press('ContextMenu');
  const menu = page.getByRole('menu', { name: /^Bar 1$/ });
  await expect(menu).toHaveAttribute('data-context-menu-via', 'keyboard');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(app.score()).toBeFocused();

  // With focus on the page itself nothing hears Chromium's event but the score's fallback.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('ContextMenu');
  await expect(page.getByRole('menu', { name: /^Bar 1$/ })).toBeVisible();
});
