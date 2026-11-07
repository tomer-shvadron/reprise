import { expect, test, type App } from './test/app';
import { generated } from './test/scores';

/** Opens the song with the mixer shown, looping the whole song so it keeps playing. */
async function playLooped(app: App): Promise<void> {
  const { page } = app;
  await page.keyboard.press('F8');
  await expect(app.strip(1)).toBeVisible();
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: /^Loop bars / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await app.expectSound();
}

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('mute, solo and volume, with undo and redo', async ({ app, page }) => {
  await playLooped(app);
  const mute = (n: number) => app.strip(n).getByRole('button', { name: `Mute Track ${String(n)}` });

  await mute(1).click();
  await mute(2).click();
  await app.expectSilence();
  const bar = await app.field('bar').textContent();
  await expect(app.field('bar')).not.toHaveText(bar ?? '');
  expect((await app.level()).peak).toBeLessThan(1e-4);

  await mute(1).click();
  await mute(2).click();
  await app.expectSound();

  const solo = app.strip(1).getByRole('button', { name: 'Solo Track 1' });
  await solo.click();
  await expect
    .poll(() =>
      page
        .locator('[data-audible]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-audible'))),
    )
    .toEqual(['true', 'false', 'true', 'false']);

  // With Track 2 soloed away, Track 1 at zero is the whole song at zero.
  const volume = app.strip(1).getByRole('slider', { name: 'Volume of Track 1' });
  await volume.focus();
  await volume.press('Home');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await app.expectSilence();

  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(volume).toHaveAttribute('aria-valuenow', '100');
  await app.expectSound();
  // Solo is session state, not history.
  await expect(solo).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await app.expectSilence();
});

test('instrument, with undo and redo', async ({ app, page }) => {
  await playLooped(app);
  const instrument = app.strip(1).getByRole('combobox', { name: 'Instrument of Track 1' });
  const status = app.strip(1).getByRole('status');

  await instrument.selectOption('29');
  await expect(instrument).toHaveValue('29');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await expect(status).toBeEmpty({ timeout: 15_000 });
  await app.expectSound();

  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(instrument).toHaveValue('25');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(instrument).toHaveValue('29');
  await expect(app.playButton).toHaveAccessibleName('Pause');
});

test('notation per track', async ({ page }) => {
  const system = page.locator('[data-system-id]').first();
  const height = async () => (await system.boundingBox())?.height ?? 0;
  const tab = await height();
  const change = async () => Math.abs((await height()) - tab);

  await page.getByRole('button', { name: 'Notation for Track 1: Tab' }).click();
  await page.getByRole('menuitemradio', { name: 'Standard notation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notation for Track 1: Std' })).toBeVisible();
  await expect.poll(change).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Notation for Track 1: Std' }).click();
  await page.getByRole('menuitemradio', { name: 'Tab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notation for Track 1: Tab' })).toBeVisible();
  await expect.poll(change).toBeLessThanOrEqual(1);
});
