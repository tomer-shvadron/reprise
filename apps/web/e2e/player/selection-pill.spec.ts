import type { Page } from '@playwright/test';

import { centre, expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

const pill = (page: Page) => page.getByRole('toolbar', { name: 'Bars 2 to 3' });

/** Selects bars 2 and 3 by dragging over them, as a player does. */
async function selectBars(app: Parameters<Parameters<typeof test>[2]>[0]['app']) {
  const bar2 = await app.barBox(2);
  const bar3 = await app.barBox(3);
  await app.dragContent(centre(bar2), centre(bar3));
}

test('a dragged range gets a toolbar beside it, which a click on it leaves alone', async ({
  app,
  page,
}) => {
  await selectBars(app);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveAttribute('data-side', /^(above|below)$/);

  const toolbar = await pill(page).boundingBox();
  const selected = await page.locator('.score-selection').first().boundingBox();
  if (!toolbar || !selected) throw new Error('no boxes');
  const side = await pill(page).getAttribute('data-side');
  if (side === 'above') expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(selected.y + 1);
  else expect(toolbar.y).toBeGreaterThanOrEqual(selected.y + selected.height - 1);

  // A press on it neither seeks nor clears the selection, and focus stays on the score.
  await pill(page).getByRole('button', { name: 'Copy bars' }).click();
  await expect(pill(page)).toBeVisible();
  await expect(app.score()).toBeFocused();
});

test('Loop turns the selection into the loop and back, and the selection stays', async ({
  app,
  page,
}) => {
  await selectBars(app);
  const loop = pill(page).getByRole('button', { name: 'Loop these bars' });
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await loop.click();
  await expect(page.getByRole('button', { name: 'Loop bars 2–3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page)).toBeVisible();
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await expect(pill(page)).toBeVisible();
});

test('it is hidden while the song plays and back when it stops', async ({ app, page }) => {
  await selectBars(app);
  await expect(pill(page)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await expect(pill(page)).toBeHidden();
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Play');
  await expect(pill(page)).toBeVisible();
});

test('Tab from the score reaches it, the arrows move inside it and Escape gives focus back', async ({
  app,
  page,
}) => {
  await selectBars(app);
  await app.score().focus();
  await page.keyboard.press('Tab');
  await expect(pill(page).getByRole('button', { name: 'Loop these bars' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    pill(page).getByRole('button', { name: 'Speed trainer on these bars' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(app.score()).toBeFocused();
  // Escape never clears the selection.
  await expect(pill(page)).toBeVisible();
});

test('Alt+F10 moves focus into it', async ({ app, page }) => {
  await selectBars(app);
  await page.keyboard.press('Alt+F10');
  await expect(pill(page).getByRole('button', { name: 'Loop these bars' })).toBeFocused();
});

test('the menu button opens the range menu named for the bars', async ({ app, page }) => {
  await selectBars(app);
  await pill(page).getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu', { name: 'Bars 2 to 3' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Loop these bars/ })).toBeVisible();
});

test('in practice mode it shows without Focus', async ({ app, page }) => {
  await selectBars(app);
  await expect(pill(page).getByRole('button', { name: 'Focus on loop' })).toBeVisible();
  await page.keyboard.press('F11');
  await expect(page.getByRole('region', { name: 'Practice controls' })).toBeVisible();
  await expect(pill(page)).toBeVisible();
  await expect(pill(page).getByRole('button', { name: 'Loop these bars' })).toBeVisible();
  await expect(pill(page).getByRole('button', { name: 'Focus on loop' })).toHaveCount(0);
});
