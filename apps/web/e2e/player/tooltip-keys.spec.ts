import { expect, test } from './test/app';
import { generated } from './test/scores';

test('keyboard focus shows a control’s key caps at once, and a rebind updates them', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  const caps = page.locator('[data-slot=tooltip-content] [data-slot=kbd]');

  // Keyboard focus, not a hover: Radix opens the tooltip with no delay.
  await app.playButton.focus();
  await expect(page.getByRole('tooltip')).toContainText('Play');
  await expect(caps).toHaveText(['Space']);
  await expect(app.playButton).toHaveAttribute('aria-keyshortcuts', 'Space');

  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await dialog.getByRole('textbox', { name: 'Filter commands or keys' }).fill('Play or pause');
  await dialog
    .getByRole('button', { name: /^Change key for Play or pause/ })
    .first()
    .click();
  await page.keyboard.press('Alt+K');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The dialog hands focus back to the play button a tick after it unmounts, which opens the
  // tooltip. Wait for that one to be gone so the second focus is a fresh open; a reopen while it
  // is leaving is covered by the test below (#438).
  await expect(app.playButton).toBeFocused();
  await app.playButton.blur();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await app.playButton.focus();
  await expect(page.getByRole('tooltip')).toContainText('Play');
  await expect(caps.last()).toHaveText('K');
  await expect(caps).toHaveCount(2);
  await expect(app.playButton).toHaveAttribute('aria-keyshortcuts', 'Alt+K');
});

test('a tooltip reopened while another is leaving still opens (#438)', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  const tooltip = page.getByRole('tooltip');

  await app.playButton.focus();
  await expect(tooltip).toContainText('Play');

  // Shift+Tab then Tab straight back: Play's tooltip is reopened while its own is still leaving.
  const previous = page.getByRole('tooltip').filter({ hasText: 'Toggle tracks' });
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(app.playButton).toBeFocused();
  // The other tooltip's exit ends when Play's does, so this waits out the window on state.
  await expect(previous).toHaveCount(0);
  await expect(tooltip).toContainText('Play');
});
