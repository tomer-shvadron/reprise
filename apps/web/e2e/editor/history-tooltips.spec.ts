import { expect, test } from '../player/test/app';
import { palette } from './test/editor';

const caps = (page: import('@playwright/test').Page) =>
  page.locator('[data-slot=tooltip-content] [data-slot=kbd]');

test('Undo in the History panel shows its key and still undoes on a click', async ({
  app,
  page,
}) => {
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'History' })
    .click();
  await page.keyboard.press('1');
  const undo = page.getByRole('button', { name: /^Undo / });
  await expect(undo).toBeEnabled();
  await undo.hover();
  await expect(page.getByRole('tooltip')).toContainText('Undo');
  await expect(caps(page)).toHaveCount(2);
  await undo.click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
