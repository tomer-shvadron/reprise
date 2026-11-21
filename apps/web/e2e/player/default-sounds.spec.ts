import { expect, test } from './test/app';
import { fixture } from './test/scores';

// The web build has no direct download and CI never installs Emilyguitar, so a guitar track
// defaults to a pack that is missing: it plays General MIDI and offers the download once (#346).
test('the missing default pack is offered once, and the mixer shows what plays', async ({
  app,
  page,
}) => {
  const path = fixture('gp5/chords.gp5');
  await app.openWithPicker(path);

  const offer = page.getByRole('status').filter({ hasText: 'Karoryfer Emilyguitar' });
  await expect(offer).toContainText('a free');
  await expect(offer.getByRole('button', { name: 'Open Sounds' })).toBeVisible();
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);

  await page.keyboard.press('F8');
  const select = page
    .getByRole('complementary', { name: 'Panel' })
    .getByRole('combobox', { name: /^Sound of/ })
    .first();
  await expect(select).toHaveValue('');
  await expect(select.locator('option', { hasText: /^Default \(General MIDI/ })).toHaveCount(1);
  await expect(page.locator('[data-sound-status]')).toContainText('GM · ');

  // The offer was recorded when it showed, so a relaunch does not repeat it.
  await page.reload();
  await app.pick('chords.gp5');
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady();
  await expect(page.locator('[data-sound-status]')).toContainText('GM · ');
  await expect(page.getByRole('status').filter({ hasText: 'Karoryfer Emilyguitar' })).toHaveCount(
    0,
  );
});
