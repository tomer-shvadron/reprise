import { expect, test } from '../player/test/app';
import { generated } from '../player/test/scores';
import { palette } from './test/editor';

test('the status bar switches the entry mode and the voice, and focus stays with the score', async ({
  app,
  page,
}) => {
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  const status = page.getByTestId('edit-status');
  await expect(status).toContainText('Overwrite');

  await status.getByRole('button', { name: 'Overwrite' }).click();
  await expect(status).toContainText('Insert');
  await status.getByRole('button', { name: 'Voice 1' }).click();
  await page.getByRole('menuitemradio', { name: /^Voice 2/ }).click();
  await expect(status).toContainText('Voice 2');
  // The click left focus on the page, so the next digit goes to the score.
  await page.keyboard.press('5');
  // A new song's cursor is at the end of bar 1; only an entered note moves it off that slot.
  await expect(status).not.toContainText('End of bar');
});

test('the status bar position opens the palette on a bar number', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await palette(app, 'Toggle edit mode');
  const status = page.getByTestId('edit-status');
  await status.getByRole('button', { name: /^Bar 1 ·/ }).click();
  const input = page.getByPlaceholder(/^Bar number/);
  await expect(input).toBeFocused();
  await input.fill('5');
  await input.press('Enter');
  await expect(status).toContainText('Bar 5 ·');
});
