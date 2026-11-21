import type { Page } from '@playwright/test';

import { expect, test } from './test/app';

/** The stored value of a setting row, read from the app's own IndexedDB. */
async function row(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('reprise');
        open.onerror = () => {
          reject(new Error('open failed'));
        };
        open.onsuccess = () => {
          const request = open.result.transaction('settings').objectStore('settings').get(name);
          request.onsuccess = () => {
            const found: unknown = request.result;
            resolve(
              typeof found === 'object' && found !== null && 'value' in found
                ? found.value
                : undefined,
            );
          };
        };
      }),
    key,
  );
}

/** Whether the score is in continuous view, read from the header's View options menu. */
async function isContinuous(page: Page): Promise<boolean> {
  await page.getByRole('button', { name: 'View options' }).click();
  const checked = await page
    .getByRole('menuitemradio', { name: /^Continuous view/ })
    .getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  return checked === 'true';
}

const VIEW = 'Toggle page and continuous view';

test('a recorded key runs the command everywhere, survives a reload, and swaps on a clash', async ({
  app,
  page,
}) => {
  await expect(app.playButton).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await dialog
    .getByRole('textbox', { name: 'Filter commands or keys' })
    .fill('page and continuous');

  await dialog.getByRole('button', { name: `Change key for ${VIEW}, now F4` }).click();
  await page.keyboard.press('F5');
  await expect(
    dialog.getByRole('button', { name: `Change key for ${VIEW}, now F5` }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // F5 toggles the view and F4 no longer does.
  await page.keyboard.press('F4');
  expect(await isContinuous(page)).toBe(false);
  await page.keyboard.press('F5');
  expect(await isContinuous(page)).toBe(true);

  // The cheat sheet shows the new key.
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByRole('listitem').filter({ hasText: VIEW })).toContainText('F5');
  await page.keyboard.press('Escape');

  await expect
    .poll(() => row(page, 'keyboard.shortcuts'))
    .toMatchObject({
      'view.toggleViewMode': { key: 'F5' },
    });
  await page.reload();
  await expect(app.playButton).toBeVisible();
  // The setting loads after the first paint: wait for the dialog to show it before pressing the key.
  await page.keyboard.press('ControlOrMeta+Comma');
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await dialog
    .getByRole('textbox', { name: 'Filter commands or keys' })
    .fill('page and continuous');
  await expect(
    dialog.getByRole('button', { name: `Change key for ${VIEW}, now F5` }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // The view mode is not stored: the page starts paged, and F5 still toggles it.
  expect(await isContinuous(page)).toBe(false);
  await page.keyboard.press('F5');
  expect(await isContinuous(page)).toBe(true);

  // F8 belongs to Toggle mixer: recording it offers a swap.
  await page.keyboard.press('ControlOrMeta+Comma');
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await dialog
    .getByRole('textbox', { name: 'Filter commands or keys' })
    .fill('page and continuous');
  await dialog.getByRole('button', { name: `Change key for ${VIEW}, now F5` }).click();
  await page.keyboard.press('F8');
  await expect(dialog.getByRole('group')).toContainText("Toggle mixer's key");
  await dialog.getByRole('button', { name: 'Swap' }).click();
  await expect(
    dialog.getByRole('button', { name: `Change key for ${VIEW}, now F8` }),
  ).toBeVisible();

  // Restore defaults: F4 toggles the view again.
  await dialog.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(
    dialog.getByRole('button', { name: `Change key for ${VIEW}, now F4` }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('F4');
  expect(await isContinuous(page)).toBe(false);
});
