import { expect, test } from '../player/test/app';
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
  await expect(status).toContainText('Bar 1');
});
