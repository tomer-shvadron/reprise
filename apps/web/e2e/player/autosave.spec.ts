import { read } from '@reprise/formats';
import type { Page } from '@playwright/test';

import { crash, expect, relaunch, test, type App } from './test/app';
import { generated } from './test/scores';

const RECOVERY = 'Reprise closed with unsaved changes';

/** The draft keys in origin-private storage: one per `.json` sidecar. */
const draftKeys = async (app: App) =>
  (await app.listStored('data/drafts'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));

/** The first track of the draft's score, read back with our own reader. */
async function draftTrack(app: App, key: string) {
  const { score } = await read(await app.readStoredPath(`data/drafts/${key}.reprise`), 'reprise');
  return score.tracks[0];
}

async function renameFirstTrack(page: Page, name: string) {
  await page.locator('body').focus();
  await page.keyboard.press('F6');
  const properties = page.getByRole('dialog', { name: 'Track properties' });
  await properties.getByLabel('Name', { exact: true }).fill(name);
  await properties.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Tracks' })
      .getByRole('button', { name: new RegExp(`^${name}`) }),
  ).toBeVisible();
}

test.describe.configure({ timeout: 120_000 });

test('a crashed page offers its draft back with the last edit, and Save clears it', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  await expect.poll(() => app.songRows()).toBe(1);
  await page.keyboard.press('F8');
  const volume = app.strip(1).getByRole('slider', { name: 'Volume of Track 1' });
  await volume.focus();
  await volume.press('PageDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '90');
  await expect(page).toHaveTitle(/^● .* — Reprise$/);

  // The draft lands about a second after the edit; wait for it to hold the edit, not for time.
  await expect.poll(async () => (await draftKeys(app)).length).toBe(1);
  const [key = ''] = await draftKeys(app);
  await expect
    .poll(async () => (await draftTrack(app, key))?.channel.volume, { timeout: 20_000 })
    .toBe(90);

  await crash(page);
  const next = await relaunch(page);
  const again = next.page;
  const dialog = again.getByRole('dialog', { name: RECOVERY });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Recover / }).click();
  await next.waitReady();
  await expect(again).toHaveTitle(/^● .* — Reprise$/);
  // The panel was open before the crash, and a relaunch brings it back.
  await expect(again.getByRole('complementary', { name: 'Panel' })).toBeVisible();
  await expect(next.strip(1).getByRole('slider', { name: 'Volume of Track 1' })).toHaveAttribute(
    'aria-valuenow',
    '90',
  );

  await again.locator('body').focus();
  await again.keyboard.press('ControlOrMeta+s');
  await expect(again).toHaveTitle(/^[^●]* — Reprise$/);
  await expect.poll(() => draftKeys(next)).toEqual([]);

  const third = await relaunch(again);
  await expect.poll(() => third.songRows()).toBe(1);
  expect(await draftKeys(third)).toEqual([]);
  await expect(third.page.getByRole('dialog', { name: RECOVERY })).toHaveCount(0);
});

test('a crashed new song is offered back as an untitled document, and its first Save adds it', async ({
  app,
  page,
}) => {
  await app.palette('New song');
  await expect(app.score()).toBeVisible();
  await renameFirstTrack(page, 'Lead');
  await expect(page).toHaveTitle(/^● .* — Reprise$/);

  await expect.poll(async () => (await draftKeys(app)).length).toBe(1);
  const [key = ''] = await draftKeys(app);
  expect(key).toMatch(/^doc-/);
  await expect
    .poll(async () => (await draftTrack(app, key))?.name, { timeout: 20_000 })
    .toBe('Lead');

  await crash(page);
  const next = await relaunch(page);
  const again = next.page;
  const dialog = again.getByRole('dialog', { name: RECOVERY });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Recover / }).click();
  await expect(
    again.getByRole('list', { name: 'Tracks' }).getByRole('button', { name: /^Lead/ }),
  ).toBeVisible();
  await expect(again).toHaveTitle(/^● .* — Reprise$/);
  // Moved to the recovered document's own key before the old files went.
  await expect
    .poll(async () => (await draftKeys(next)).filter((name) => name !== key).length)
    .toBe(1);
  expect(await draftKeys(next)).not.toContain(key);

  await again.locator('body').focus();
  await again.keyboard.press('ControlOrMeta+s');
  await expect(again).toHaveTitle(/^[^●]* — Reprise$/);
  await expect.poll(() => next.songRows()).toBe(1);
  await expect.poll(() => draftKeys(next)).toEqual([]);
});
