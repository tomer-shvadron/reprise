import { expect, test } from './test/app';
import { generated } from './test/scores';

// New song is reached from the palette here: browsers keep Ctrl+N and ⌘N for themselves.
test('New song replaces a modified song, and tracks are added, moved and removed with undo', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));

  await page.locator('body').focus();
  await page.keyboard.press('F6');
  const properties = page.getByRole('dialog', { name: 'Track properties' });
  await properties.getByLabel('Name', { exact: true }).fill('Renamed');
  await properties.getByRole('button', { name: 'Apply' }).click();
  const tracks = page.getByRole('list', { name: 'Tracks' });
  await expect(tracks.getByRole('button', { name: /^Renamed/ })).toBeVisible();

  await app.palette('New song');
  const prompt = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(prompt).toContainText('before starting a new song');
  await prompt.getByRole('button', { name: 'Don’t save' }).click();
  await expect(tracks.getByRole('listitem')).toHaveCount(1);
  await expect(tracks.getByRole('button', { name: /^Guitar/ })).toBeVisible();
  await expect(app.field('bar')).toHaveText(/^1\//);

  await page.getByRole('button', { name: 'Add track' }).click();
  const add = page.getByRole('dialog', { name: 'Add track' });
  await add.getByLabel('Strings').selectOption('4');
  await add.getByLabel('Tuning').selectOption('Bass standard');
  await add.getByLabel('Capo').fill('2');
  await add.getByRole('button', { name: 'Add track' }).click();
  await expect(tracks.getByRole('listitem')).toHaveCount(2);
  const names = () => tracks.getByRole('listitem').locator('button.truncate .font-medium');
  await expect(names()).toHaveText(['Guitar', 'Bass']);

  await page.getByRole('button', { name: 'Track actions for Bass' }).click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(names()).toHaveText(['Bass', 'Guitar']);

  await page.getByRole('button', { name: 'Track actions for Bass' }).click();
  await page.getByRole('menuitem', { name: 'Remove…' }).click();
  await expect(names()).toHaveText(['Guitar']);

  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(names()).toHaveText(['Bass', 'Guitar']);
});
