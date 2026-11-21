import type { Page } from '@playwright/test';

import { expect, test } from '../player/test/app';
import { generated } from '../player/test/scores';

// #339 part 2: the selection pill in edit mode.
test.beforeEach(async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('edit-status')).toBeVisible();
});

const fretNumbers = (page: Page) =>
  page.locator('svg[data-system-id] text').filter({ hasText: /^\d+$/ });

async function clickNote(page: Page, index: number, shift = false): Promise<void> {
  const box = await fretNumbers(page).nth(index).boundingBox();
  if (!box) throw new Error('no fret number to click');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up('Shift');
}

const pill = (page: Page) => page.getByRole('toolbar', { name: /^(Note|Beat|Bar|Bars)/ });

test('clicking a note shows the toolbar over it, and an effect press keeps focus on the score', async ({
  app,
  page,
}) => {
  await clickNote(page, 4);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveAttribute('data-side', /^(above|below)$/);

  const vibrato = pill(page).getByRole('button', { name: /vibrato/i });
  await expect(vibrato).toHaveAttribute('aria-pressed', 'false');
  await vibrato.click();
  await expect(vibrato).toHaveAttribute('aria-pressed', 'true');
  await expect(app.score()).toBeFocused();
  // The Effects panel reads the same state.
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'Effects' })
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Panel' })
      .getByRole('button', { name: 'Vibrato', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a typed digit still enters a fret after the pill was used', async ({ page }) => {
  await clickNote(page, 4);
  await pill(page)
    .getByRole('button', { name: /vibrato/i })
    .click();
  await page.keyboard.press('ArrowRight');
  // A 1 waits for a second digit; while it does, the toolbar is out of the way.
  await page.keyboard.press('1');
  await expect(page.getByTestId('edit-status')).toContainText('Fret 1');
  await expect(pill(page)).toBeHidden();
  await page.keyboard.press('2');
  await expect(page.getByTestId('edit-status')).not.toContainText('Fret 1');
  await expect(pill(page)).toBeVisible();
});

test('B opens the bend dialog, and Escape closes it', async ({ page }) => {
  await clickNote(page, 4);
  await pill(page).getByRole('button', { name: /^Bend/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Bend' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the duration menu changes the entry duration, and the range survives Escape in the toolbar', async ({
  page,
}) => {
  await clickNote(page, 2);
  await clickNote(page, 5, true);
  await expect(pill(page)).toBeVisible();
  await pill(page)
    .getByRole('button', { name: /^Duration, / })
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.keyboard.press('Alt+F10');
  await expect(pill(page).locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(pill(page)).toBeVisible();
  await expect(page.locator('.score-range').first()).toBeVisible();
});
