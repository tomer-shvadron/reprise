import { expect, test } from './test/app';
import { generated } from './test/scores';

const HEADER_HEIGHT = 28;
const TRANSPORT_HEIGHT = 56;
const STATUS_HEIGHT = 24;

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('the score region loses exactly the header, the dock strip, the transport and the status bar', async ({
  page,
}) => {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const score = await page.getByRole('main', { name: 'Score' }).boundingBox();
  // The dock's strip is always there, collapsed; its height is the app's, so it is read, not fixed.
  const dock = await page.getByRole('region', { name: 'Bottom panel' }).boundingBox();
  expect(dock?.height).toBeGreaterThan(0);
  const banner = await page.getByRole('banner').boundingBox();
  expect(banner?.height).toBeCloseTo(HEADER_HEIGHT, 0);
  expect(score?.height).toBeCloseTo(
    (viewport?.height ?? 0) -
      HEADER_HEIGHT -
      (dock?.height ?? 0) -
      TRANSPORT_HEIGHT -
      STATUS_HEIGHT,
    0,
  );
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

test('choosing from the View menu leaves focus with the page, so Space plays', async ({
  app,
  page,
}) => {
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemradio', { name: /^Continuous view/ }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
});

test('the crumb opens the library and Escape closes it', async ({ page }) => {
  await page.getByRole('banner').getByRole('button', { name: 'Library' }).click();
  await expect(page.getByRole('dialog', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Library' })).toHaveCount(0);
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
