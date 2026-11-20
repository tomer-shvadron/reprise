import type { Page } from '@playwright/test';

import { expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Panel rail' });

test('the rail stays visible while the panel is collapsed and F8 still toggles it', async ({
  page,
}) => {
  await expect(rail(page)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Panel' })).toHaveCount(0);

  await page.keyboard.press('F8');
  await expect(page.getByRole('tab', { name: 'Mixer' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('F8');
  await expect(page.getByRole('complementary', { name: 'Panel' })).toHaveCount(0);
  await expect(rail(page)).toBeVisible();
});

test('a rail icon opens its view, and the tabs switch views and Practice tools', async ({
  page,
}) => {
  await rail(page).getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Practice' }).click();
  await expect(page.getByRole('tablist', { name: 'Practice tools' })).toBeVisible();
  await page.getByRole('tab', { name: 'Metronome' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Metronome' })).toBeVisible();
});

/** The stored value of a setting, or undefined until its row is written. */
const storedSetting = (page: Page, key: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('reprise');
        open.onerror = () => {
          resolve(undefined);
        };
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('settings')) {
            db.close();
            resolve(undefined);
            return;
          }
          const get = db.transaction('settings').objectStore('settings').get(name);
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { value?: unknown } | undefined)?.value);
          };
          get.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
      }),
    key,
  );

test('the open state and the width survive a reload', async ({ app, page }) => {
  await rail(page).getByRole('button', { name: 'Mixer' }).click();
  const handle = page.getByRole('separator', { name: 'Resize panel' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const width = await handle.getAttribute('aria-valuenow');
  expect(Number(width)).toBeGreaterThan(320);
  // The width is written once the resize settles, and a reload must not beat the write.
  await expect.poll(() => storedSetting(page, 'layout.rightPanelWidth')).toBe(Number(width));
  await expect.poll(() => storedSetting(page, 'layout.rightPanelOpen')).toBe(true);

  await page.reload();
  await app.openWithPicker(generated('song.gp'));
  await expect(page.getByRole('complementary', { name: 'Panel' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize panel' })).toHaveAttribute(
    'aria-valuenow',
    width ?? '',
  );

  await page.getByRole('button', { name: 'Collapse panel' }).click();
  await expect.poll(() => storedSetting(page, 'layout.rightPanelOpen')).toBe(false);
  await page.reload();
  await expect(rail(page)).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Panel' })).toHaveCount(0);
});
