import type { Page } from '@playwright/test';

import { expect, test, type App } from './test/app';
import {
  LIBRARY_SONGS,
  fixture,
  generated,
  libraryFile,
  libraryTitle,
  manifestEntry,
  REPO,
} from './test/scores';
import { readFileSync } from 'node:fs';

const FIXTURE_COUNT = (
  JSON.parse(readFileSync(`${REPO}fixtures/manifest.json`, 'utf8')) as { fixtures: unknown[] }
).fixtures.length;
const TOTAL = FIXTURE_COUNT + LIBRARY_SONGS;

const songs = (page: Page) => page.getByRole('listbox', { name: 'Songs' }).getByRole('option');
const mute = (app: App, n: number) =>
  app.strip(n).getByRole('button', { name: `Mute Track ${String(n)}` });

/** Stages every fixture and the generated songs in origin-private storage and queues them. */
async function queueEverything(app: App): Promise<void> {
  const manifest = JSON.parse(readFileSync(`${REPO}fixtures/manifest.json`, 'utf8')) as {
    fixtures: { path: string }[];
  };
  for (const { path } of manifest.fixtures) {
    // A name with the folder in it: two fixtures may share a file name in different formats.
    const name = path.replace('/', '__');
    await app.stage(fixture(path), name);
    await app.pick(name);
  }
  for (let n = 1; n <= LIBRARY_SONGS; n += 1) {
    await app.stage(generated(libraryFile(n)), libraryFile(n));
    await app.pick(libraryFile(n));
  }
}

async function openLibrary(app: App): Promise<void> {
  await app.palette('Show library');
  await expect(songs(app.page).first()).toBeVisible();
}

async function openFromLibrary(app: App, title: string): Promise<void> {
  const { page } = app;
  const search = page.getByRole('searchbox', { name: 'Search songs' });
  await search.fill(title);
  await expect(songs(page)).toHaveCount(1);
  await songs(page).first().dblclick();
  await expect(page.getByRole('region', { name: 'Library', exact: true })).toHaveCount(0);
  await app.waitReady();
}

test('imports fifty songs, finds one, plays it, restores its session, persists and deletes', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  // A user has pressed something by now, and that gesture builds the one AudioContext.
  await app.gesture();
  await queueEverything(app);
  await app.palette('Import files to library');

  await expect(page.getByRole('status').filter({ hasText: /^Imported / })).toHaveText(
    new RegExp(`^Imported ${String(TOTAL)}(?!\\d)`),
    { timeout: 60_000 },
  );
  await expect(songs(page).first()).toHaveAttribute('aria-setsize', String(TOTAL));
  expect(manifestEntry('gp5/chords.gp5').bars).toBeGreaterThan(0);

  // Search narrows the list; a double-click opens the song and it plays.
  await openFromLibrary(app, libraryTitle(7));
  await expect(app.score()).toHaveAccessibleName(`Score: ${libraryTitle(7)}`);
  await app.playButton.click();
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await app.expectSound();
  await app.playButton.click();

  // A session change is kept: mute track 1, open another song, come back.
  await page.keyboard.press('F8');
  await mute(app, 1).click();
  await expect(mute(app, 1)).toHaveAttribute('aria-pressed', 'true');
  await openLibrary(app);
  await openFromLibrary(app, libraryTitle(8));
  await openLibrary(app);
  await openFromLibrary(app, libraryTitle(7));
  await expect(mute(app, 1)).toHaveAttribute('aria-pressed', 'true');

  // The library survives a reload (IndexedDB for the rows, origin-private storage for the files).
  await page.reload();
  await openLibrary(app);
  await expect(songs(page).first()).toHaveAttribute('aria-setsize', String(TOTAL));
  await openFromLibrary(app, libraryTitle(7));

  // Delete asks first, then removes the row.
  await openLibrary(app);
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(libraryTitle(9));
  await expect(songs(page)).toHaveCount(1);
  await page.getByRole('listbox', { name: 'Songs' }).focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(libraryTitle(9));
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(songs(page)).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search songs' }).fill('');
  await expect(songs(page).first()).toHaveAttribute('aria-setsize', String(TOTAL - 1));
});

test('a file opened with the picker joins the library, and a repeat opens the same song', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  await openLibrary(app);
  await expect(songs(page)).toHaveCount(1);
  await page.keyboard.press('Escape');

  // The repeat is the library's own copy, named for the stored native.
  await app.stage(generated('song.gp'));
  await app.pick('song.gp');
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady('song.reprise');
  await openLibrary(app);
  await expect(songs(page)).toHaveCount(1);
});

test('open without importing shows the banner, and Import adds the song', async ({ app, page }) => {
  await app.stage(generated('song.gp'));
  await app.pick('song.gp');
  await app.palette('Open without importing');
  await app.waitReady('song.gp');
  const banner = page.getByRole('region', { name: 'Unimported song' });
  await expect(banner).toContainText('Not in your library');

  await banner.getByRole('button', { name: 'Import' }).click();
  await expect(banner).toHaveCount(0);
  await openLibrary(app);
  await expect(songs(page)).toHaveCount(1);
});
