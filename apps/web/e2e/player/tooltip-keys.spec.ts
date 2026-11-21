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

  await app.playButton.blur();
  await app.playButton.focus();
  await expect(page.getByRole('tooltip')).toContainText('Play');
  await expect(caps.last()).toHaveText('K');
  await expect(caps).toHaveCount(2);
  await expect(app.playButton).toHaveAttribute('aria-keyshortcuts', 'Alt+K');
});
