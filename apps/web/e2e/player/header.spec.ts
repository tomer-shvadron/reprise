import { expect, test } from './test/app';
import { generated } from './test/scores';

const HEADER_HEIGHT = 28;
const TRANSPORT_HEIGHT = 56;

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('the score region loses exactly the header band', async ({ page }) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const score = await page.getByRole('main', { name: 'Score' }).boundingBox();
  const banner = await page.getByRole('banner').boundingBox();
  expect(banner?.height).toBeCloseTo(HEADER_HEIGHT, 0);
  expect(score?.height).toBeCloseTo((viewport?.height ?? 0) - HEADER_HEIGHT - TRANSPORT_HEIGHT, 0);
});

test('a click on a mode does not take focus, so Space still plays', async ({ app, page }) => {
  const modes = page.getByRole('radiogroup', { name: 'Mode' });
  await modes.getByRole('radio', { name: 'Edit' }).click();
  await expect(modes.getByRole('radio', { name: 'Edit' })).toBeChecked();
  await modes.getByRole('radio', { name: 'Play' }).click();
  await expect(modes.getByRole('radio', { name: 'Play' })).toBeChecked();
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Play');
});

test('the crumb opens the library and Escape returns to the player', async ({ page }) => {
  await page.getByRole('banner').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByRole('region', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Library' })).toHaveCount(0);
});

test('at the narrowest window the band keeps its height and every control fits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const banner = page.getByRole('banner');
  await expect(banner).toBeVisible();
  const fit = await banner.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflows: element.scrollWidth > element.clientWidth,
  }));
  expect(fit.height).toBeCloseTo(HEADER_HEIGHT, 0);
  expect(fit.overflows).toBe(false);
  for (const control of [
    banner.getByRole('button', { name: 'Library' }),
    banner.getByRole('radio', { name: 'Play' }),
    banner.getByRole('radio', { name: 'Edit' }),
    banner.getByRole('button', { name: 'View options' }),
    banner.getByRole('button', { name: 'Search commands' }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 800).toBe(true);
  }
});
