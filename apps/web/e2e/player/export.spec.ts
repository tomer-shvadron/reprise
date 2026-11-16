import { read } from '@reprise/formats';

import { expect, test } from './test/app';
import { generated } from './test/scores';

test('Export as Guitar Pro writes a .gp copy, remembers the warning, and leaves the song alone', async ({
  app,
  page,
}) => {
  // The score region is named after the song's title here, not its file.
  await app.stage(generated('export-full.reprise'));
  await app.pick('export-full.reprise');
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady();
  // The import lands a moment after the file opens; the row is what carries the remembered choice.
  await expect.poll(() => app.listStored('library/songs')).toHaveLength(1);
  const [native] = await app.listStored('library/songs');
  const nativePath = `library/songs/${native ?? ''}`;
  const nativeBefore = await app.readStoredPath(nativePath);

  await page.keyboard.press('F8');
  const volume = page
    .getByRole('complementary', { name: 'Panel' })
    .getByRole('slider', { name: 'Volume of Guitar' });
  await volume.focus();
  await volume.press('PageDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '80');

  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Shift+e');
  const dialog = page.getByRole('dialog', { name: /^Export .+\.gp\?$/ });
  await expect(
    dialog.getByRole('list', { name: 'What will be lost' }).getByRole('listitem').first(),
  ).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Don’t warn again for this song' }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect.poll(async () => (await app.saves()).length).toBe(1);
  const [save] = await app.saves();
  const name = save?.suggestedName ?? '';
  expect(name).toMatch(/\.gp$/);
  await expect.poll(() => app.writeCount(name)).toBeGreaterThan(0);

  // Our reader reads back what was written: the edit made before exporting is in the file.
  const { score } = await read(await app.readStored(name), 'gp');
  expect(score.tracks[0]?.channel.volume).toBe(80);

  // The song is as it was: the export saved nothing, so the library copy is untouched.
  expect(await app.readStoredPath(nativePath)).toEqual(nativeBefore);

  // The same losses were accepted for this song, so the second export asks nothing.
  const before = await app.writeCount(name);
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Shift+e');
  await app.waitForWrite(name, before);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await app.saves()).toHaveLength(2);
});
