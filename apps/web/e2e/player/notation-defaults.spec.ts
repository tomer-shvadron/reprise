import { expect, test } from './test/app';
import { fixture } from './test/scores';

test('a notation default applies to a file that chooses none, never to one that does', async ({
  app,
  page,
}) => {
  await expect(app.playButton).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Score' }).click();
  await dialog
    .getByRole('radiogroup', { name: 'String instruments' })
    .getByRole('radio', { name: 'Both' })
    .click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // A gp4 file states no notation, so its guitar takes the default.
  await app.openWithPicker(fixture('gp4/notes.gp4'));
  await expect(page.getByRole('button', { name: 'Notation for Track 1: Both' })).toBeVisible();

  // A gp5 file states it per track, and the default leaves that alone.
  await app.openWithPicker(fixture('gp5/staves.gp5'));
  await expect(
    page.getByRole('button', { name: 'Notation for Tablature Only: Tab' }),
  ).toBeVisible();
});
