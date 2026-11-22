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

test('the library and sound segments open their sheets', async ({ page }) => {
  const bar = page.getByRole('region', { name: 'Status' });
  await bar.getByRole('button', { name: /library/i }).click();
  await expect(page.getByRole('dialog', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Library' })).toHaveCount(0);
  await bar.locator('[data-sound-status]').click();
  await expect(page.getByRole('dialog', { name: 'Sounds' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sounds' })).toHaveCount(0);
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

test('at the narrowest window the groups never overlap and nothing leaves the bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // The standalone click running adds the metronome segment, which must shed to its dot.
  await page.keyboard.press('Alt+b');
  await expect(page.getByRole('button', { name: 'Metronome on' })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Edit' }).click();
  const bar = page.getByRole('region', { name: 'Status' });
  const edit = page.getByTestId('edit-status');
  // A dotted triplet is a long duration label, and inserting it into a full bar is refused with a
  // long message: the widest state the bar reaches.
  await edit.getByRole('button', { name: 'Overwrite' }).click();
  await page.keyboard.press('.');
  await page.keyboard.press('/');
  await page.keyboard.press('5');
  await expect(edit.getByRole('status')).not.toHaveText('');
  {
    const fit = await bar.evaluate((element) => {
      const reach = (group: Element | null) => {
        const rects = [...(group?.querySelectorAll('button, [role="status"]') ?? [])]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0); // a shed segment is display:none, with an empty rect
        return {
          left: Math.min(...rects.map((rect) => rect.left)),
          right: Math.max(...rects.map((rect) => rect.right)),
        };
      };
      const song = reach(element.querySelector('[aria-label="Song"]'));
      const cursor = reach(element.querySelector('[aria-label="Cursor and view"]'));
      const box = element.getBoundingClientRect();
      return {
        height: box.height,
        songRight: song.right,
        cursorLeft: cursor.left,
        cursorRight: cursor.right,
        barRight: box.right,
        barLeft: box.left,
        songLeft: song.left,
      };
    });
    expect(fit.height).toBeCloseTo(STATUS_HEIGHT, 0);
    expect(fit.songRight).toBeLessThanOrEqual(fit.cursorLeft);
    expect(fit.songLeft).toBeGreaterThanOrEqual(fit.barLeft);
    expect(fit.cursorRight).toBeLessThanOrEqual(fit.barRight);
  }
  for (const name of [
    /^(Saved|Unsaved)$/,
    /^Metronome on$/,
    /^(Insert|Overwrite)$/,
    /^Voice \d$/,
    /^\d+%$/,
  ]) {
    await expect(bar.getByRole('button', { name }).first()).toBeVisible();
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`every segment is at least 4.5:1 on the bar in the ${theme} theme`, async ({
    app,
    page,
  }) => {
    const html = page.locator('html');
    if ((await html.getAttribute('data-theme')) !== theme) await app.palette('Toggle theme');
    await expect(html).toHaveAttribute('data-theme', theme);
    await page
      .getByRole('radiogroup', { name: 'Mode' })
      .getByRole('radio', { name: 'Edit' })
      .click();
    await expect(page.getByTestId('edit-status')).toBeVisible();
    // `transition-all` is in flight after the flip; a half-faded colour is not what the theme shows.
    await page.waitForFunction(() => document.getAnimations().length === 0);
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
