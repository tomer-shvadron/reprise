import { readFileSync } from 'node:fs';

import { expect, test } from './test/app';
import { FORMATS, SONG, fixture, generated, manifestEntry } from './test/scores';

test('opens with the shortcut through the picker and renders', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));

  const region = app.score();
  await expect(region).toHaveAccessibleName('Score: song.gp');
  await expect(region).toHaveAttribute('aria-busy', 'false');
  expect(await app.description()).toBe(SONG.description);
  await expect(page.locator('[data-system-id]').first()).toBeVisible();
  const tracks = page.getByRole('complementary', { name: 'Tracks' });
  await expect(tracks.getByText('Track 1', { exact: true })).toBeVisible();
  await expect(tracks.getByText('Track 2', { exact: true })).toBeVisible();
  await expect(app.field('bar')).toHaveText('1/16');
  await expect(app.field('beat')).toHaveText('1/4');
  await expect(app.field('time')).toHaveText(`0:00 ${SONG.total}`);
  await expect(app.playButton).toBeEnabled();
});

test('opens from the palette', async ({ app }) => {
  await app.openFromPalette(fixture('gp5/chords.gp5'));

  expect(await app.description()).toBe('2 bars, 1 page');
  await expect(app.playButton).toBeEnabled();
});

test('a cancelled picker changes nothing', async ({ app, page }) => {
  await page.keyboard.press('ControlOrMeta+o');

  await expect(page.getByText('No file open.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(app.score()).toHaveCount(0);
});

test('a drop opens every format, each replacing the last', async ({ app }) => {
  const opened: [path: string, bars: number][] = [
    ...FORMATS.map((path): [string, number] => [fixture(path), manifestEntry(path).bars]),
    [generated('song.reprise'), SONG.bars],
  ];
  for (const [path, bars] of opened) {
    const name = path.split('/').at(-1) ?? path;
    await app.drop(path, name);
    await app.waitReady(name);
    expect(await app.description()).toMatch(new RegExp(`^${String(bars)} bars?\\b`));
  }

  const before = await app.description();
  await app.drop(fixture('gp5/percussion-all.gp5'));
  await app.waitReady('percussion-all.gp5');
  expect(await app.description()).not.toBe(before);
  expect(await app.contexts()).toBeLessThanOrEqual(1);
});

test('an unknown file shows an error and keeps the song', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));

  await app.dropBytes(new TextEncoder().encode('not a score'), 'notes.txt');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not open notes.txt');
  await expect(alert).toContainText('Not a Guitar Pro or Reprise file (unknown-format)');
  await expect(app.score()).toHaveAccessibleName('Score: song.gp');
  expect(await app.description()).toBe(SONG.description);
});

test('a damaged gp5 opens what it can, with a warning', async ({ app, page }) => {
  const damaged = readFileSync(fixture('gp5/effects.gp5')).subarray(0, 400);

  await app.dropBytes(new Uint8Array(damaged), 'broken.gp5');

  const status = page
    .getByRole('region', { name: 'Notifications' })
    .getByRole('status')
    .filter({ hasText: /^Opened broken\.gp5 with \d+ warnings?/ });
  await expect(status).toBeVisible();
  await status.getByRole('button', { name: 'Details' }).click();
  await expect(
    page.getByRole('list', { name: 'Import details' }).getByRole('listitem'),
  ).not.toHaveCount(0);
});
