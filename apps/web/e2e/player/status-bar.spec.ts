import { cssContrast } from '../../src/test/contrast';
import { expect, test } from './test/app';
import { generated } from './test/scores';

const STATUS_HEIGHT = 24;

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('entering edit mode leaves the score exactly as tall as it was', async ({ page }) => {
  const score = page.getByRole('main', { name: 'Score' });
  const before = await score.boundingBox();
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Edit' }).click();
  await expect(page.getByTestId('edit-status')).toBeVisible();
  const after = await score.boundingBox();
  expect(after?.height).toBe(before?.height);
  const bar = await page.getByRole('region', { name: 'Status' }).boundingBox();
  expect(bar?.height).toBeCloseTo(STATUS_HEIGHT, 0);
});

test('the library and sound segments open their screens', async ({ page }) => {
  const bar = page.getByRole('region', { name: 'Status' });
  await bar.getByRole('button', { name: /library/i }).click();
  await expect(page.getByRole('region', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Library' })).toHaveCount(0);
  await bar.locator('[data-sound-status]').click();
  await expect(page.getByRole('region', { name: 'Sounds' })).toBeVisible();
});

test('zooming from the zoom segment keeps focus with the page, so Space plays', async ({
  app,
  page,
}) => {
  const bar = page.getByRole('region', { name: 'Status' });
  await bar.getByRole('button', { name: '100%' }).click();
  await page.getByRole('menuitem', { name: /^Zoom in/ }).click();
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: '110%' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
});

test('at the narrowest window the bar keeps its height and the long edit state fits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Edit' }).click();
  // The longest duration label the bar can show.
  await page.keyboard.press('.');
  await page.keyboard.press('/');
  const bar = page.getByRole('region', { name: 'Status' });
  await expect(bar).toBeVisible();
  const fit = await bar.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflows: element.scrollWidth > element.clientWidth,
  }));
  expect(fit.height).toBeCloseTo(STATUS_HEIGHT, 0);
  expect(fit.overflows).toBe(false);
  for (const name of [/^(Saved|Unsaved)$/, /^(Insert|Overwrite)$/, /^Voice \d$/, /^\d+%$/]) {
    const box = await bar.getByRole('button', { name }).first().boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 800).toBe(true);
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`every segment is at least 4.5:1 on the bar in the ${theme} theme`, async ({ page }) => {
    await page.evaluate((next) => {
      document.documentElement.dataset['theme'] = next;
    }, theme);
    await page
      .getByRole('radiogroup', { name: 'Mode' })
      .getByRole('radio', { name: 'Edit' })
      .click();
    const bar = page.getByRole('region', { name: 'Status' });
    const colours = await bar.evaluate((element) => {
      const background = getComputedStyle(element).backgroundColor;
      return [...element.querySelectorAll('button, [role="status"], span')].flatMap((node) => {
        if (!node.textContent.trim() || node.children.length > 0 || node.closest('[aria-hidden]')) {
          return [];
        }
        return [{ text: node.textContent, color: getComputedStyle(node).color, background }];
      });
    });
    expect(colours.length).toBeGreaterThan(3);
    for (const { text, color, background } of colours) {
      expect(cssContrast(color, background), `${text} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
