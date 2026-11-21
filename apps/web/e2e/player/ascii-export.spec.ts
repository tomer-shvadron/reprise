import { expect, test } from './test/app';
import { generated, SECTIONS } from './test/scores';

test('Export as ASCII tab writes a .txt of the current track through the save dialog', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated(SECTIONS.file));
  await app.palette('Export as ASCII tab');
  const dialog = page.getByRole('dialog', { name: 'Export as ASCII tab' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: 'Line width' })).toHaveValue('80');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect.poll(async () => (await app.saves()).length).toBe(1);
  const [save] = await app.saves();
  const name = save?.suggestedName ?? '';
  expect(name).toMatch(/\.txt$/);
  await expect.poll(() => app.writeCount(name)).toBeGreaterThan(0);
  const text = new TextDecoder().decode(await app.readStored(name));
  expect(text).toMatch(/Tuning: /);
  expect(text).toMatch(/^[eEBGDA]\|/mu);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
