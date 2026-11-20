import { readFileSync } from 'node:fs';

import { read } from '@reprise/formats';
import type { Score } from '@reprise/model';

import { expect, test } from './test/app';
import { fixture, generated } from './test/scores';

const notes = (score: Score) =>
  score.tracks
    .flatMap((track) => track.bars)
    .flatMap((bar) => bar.voices)
    .flatMap((voice) => voice.beats)
    .reduce((sum, beat) => sum + beat.notes.length, 0);

// Only a file opened without importing is saved where it is; an imported one is saved to its
// library copy (WP-061).
test('Save writes a .gp file opened without importing in place, and it reopens as saved', async ({
  app,
  page,
}) => {
  await app.stage(generated('song.gp'));
  await app.pick('song.gp');
  await app.palette('Open without importing');
  await app.waitReady('song.gp');
  await page.getByRole('button', { name: 'Notation for Track 1: Tab' }).click();
  await page.getByRole('menuitemradio', { name: 'Standard notation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notation for Track 1: Std' })).toBeVisible();
  await page.keyboard.press('F8');
  const volume = app.strip(1).getByRole('slider', { name: 'Volume of Track 1' });
  await volume.focus();
  await volume.press('PageDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '90');

  const before = await app.writeCount('song.gp');
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: 'Save song.gp?' });
  // What Guitar Pro 7–8 cannot hold of this score, found by the writer's own read-back.
  await expect(
    dialog.getByRole('list', { name: 'What will be lost' }).getByRole('listitem'),
  ).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await app.waitForWrite('song.gp', before);
  // In place: the save picker is never asked for a location.
  expect(await app.saves()).toEqual([]);

  const { score } = await read(await app.readStored('song.gp'), 'gp');
  expect(score.tracks[0]?.channel.volume).toBe(90);
  expect(score.tracks[0]?.display.notation).toBe('standard');
  expect(score.masterBars).toHaveLength(16);

  await page.reload();
  await app.pick('song.gp');
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady('song.gp');
  await expect(page.getByRole('button', { name: 'Notation for Track 1: Std' })).toBeVisible();
  // The mixer was open before the reload, and a reload brings it back.
  await expect(page.getByRole('complementary', { name: 'Panel' })).toBeVisible();
  await expect(app.strip(1).getByRole('slider', { name: 'Volume of Track 1' })).toHaveAttribute(
    'aria-valuenow',
    '90',
  );
});

test('Save writes an imported .gp to its library copy and leaves the original alone', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  await expect.poll(() => app.listStored('library/songs')).toHaveLength(1);
  const [native] = await app.listStored('library/songs');
  const original = await app.readStored('song.gp');
  await page.keyboard.press('F8');
  const volume = app.strip(1).getByRole('slider', { name: 'Volume of Track 1' });
  await volume.focus();
  await volume.press('PageDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '90');

  const before = await app.writeCount(native ?? '');
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+s');
  await app.waitForWrite(native ?? '', before);
  // No question about Guitar Pro losses and no picker: the song is in the library.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await app.saves()).toEqual([]);

  const { score } = await read(
    await app.readStoredPath(`library/songs/${native ?? ''}`),
    'reprise',
  );
  expect(score.tracks[0]?.channel.volume).toBe(90);
  expect(await app.readStored('song.gp')).toEqual(original);
});

test('Save on a .gp5 opened without importing becomes Save As, and the notice goes once it wrote', async ({
  app,
  page,
}) => {
  await app.stage(fixture('gp5/chords.gp5'));
  await app.pick('chords.gp5');
  await app.palette('Open without importing');
  await app.waitReady('chords.gp5');
  const name = 'chords.reprise';
  const before = await app.writeCount(name);
  await page.keyboard.press('ControlOrMeta+s');

  await app.waitForWrite(name, before);
  // The notice that said why Save became Save As is gone: that Save As has written.
  await expect(page.getByText(/so Save became Save As/)).toHaveCount(0);
  expect(await app.saves()).toEqual([
    {
      suggestedName: name,
      types: [{ description: 'Reprise', accept: { 'application/octet-stream': ['.reprise'] } }],
    },
  ]);
  const saved = (await read(await app.readStored(name), 'reprise')).score;
  const original = (await read(new Uint8Array(readFileSync(fixture('gp5/chords.gp5'))), 'gp5'))
    .score;
  expect(saved.masterBars).toHaveLength(2);
  expect(saved.tracks).toHaveLength(original.tracks.length);
  expect(notes(saved)).toBe(notes(original));

  await app.pick(name);
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady(name);
  expect(await app.description()).toBe('2 bars, 1 page');
});
