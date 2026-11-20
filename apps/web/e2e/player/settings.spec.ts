import type { Page } from '@playwright/test';

import { expect, test } from './test/app';

declare global {
  interface Window {
    __themes?: string[];
  }
}

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

// System is dark here, so a flash of the wrong theme would show on reload.
test.use({ colorScheme: 'dark' });

test('the defaults, then a changed setting survives a reload with no dark flash', async ({
  app,
  page,
}) => {
  await expect(app.playButton).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();

  // The defaults.
  await expect(dialog.getByRole('radio', { name: 'System' })).toBeChecked();
  await dialog.getByRole('tab', { name: 'Score' }).click();
  await expect(dialog.getByRole('radio', { name: 'Page' })).toBeChecked();
  await expect(dialog.getByRole('slider', { name: 'Default zoom' })).toHaveAttribute(
    'aria-valuetext',
    '100%',
  );
  await dialog.getByRole('tab', { name: 'Playback and practice' }).click();
  await expect(dialog.getByRole('switch', { name: 'Count-in' })).not.toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Follow the playhead' })).toBeChecked();

  // Change one in each section.
  await dialog.getByRole('switch', { name: 'Count-in' }).click();
  await dialog.getByRole('switch', { name: 'Follow the playhead' }).click();
  await dialog.getByRole('tab', { name: 'Score' }).click();
  await dialog.getByRole('radio', { name: 'Continuous' }).click();
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await dialog.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Writes are asynchronous; reload only once the last of them is in the table.
  await expect.poll(() => row(page, 'score.defaultViewMode')).toBe('continuous');
  await expect.poll(() => row(page, 'playback.followPlayhead')).toBe(false);
  await expect.poll(() => row(page, 'playback.countIn')).toBe(true);

  await page.addInitScript(() => {
    window.__themes = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const value = (record.target as Element).getAttribute('data-theme');
        if (value !== null) window.__themes?.push(value);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Count-in' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Never dark, even for the first paint: the set of values the attribute held is just light.
  expect([...new Set(await page.evaluate(() => window.__themes))]).toEqual(['light']);

  await page.getByRole('button', { name: 'View options' }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Continuous view/ })).toBeChecked();
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(dialog.getByRole('radio', { name: 'Light' })).toBeChecked();
  await dialog.getByRole('tab', { name: 'Score' }).click();
  await expect(dialog.getByRole('radio', { name: 'Continuous' })).toBeChecked();
  await dialog.getByRole('tab', { name: 'Playback and practice' }).click();
  await expect(dialog.getByRole('switch', { name: 'Count-in' })).toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Follow the playhead' })).not.toBeChecked();

  // Restore defaults resets this section only.
  await dialog.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(dialog.getByRole('switch', { name: 'Count-in' })).not.toBeChecked();
  await expect(dialog.getByRole('switch', { name: 'Follow the playhead' })).toBeChecked();
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await expect(dialog.getByRole('radio', { name: 'Light' })).toBeChecked();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
