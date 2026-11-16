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

test('Save writes a .gp file in place, and it reopens as saved', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
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
  await page.keyboard.press('F8');
  await expect(app.strip(1).getByRole('slider', { name: 'Volume of Track 1' })).toHaveAttribute(
    'aria-valuenow',
    '90',
  );
});

// Save As writes .reprise only, with no format question; .gp is an export (WP-061).
test('Save As from a .gp5 file writes a .reprise, which reopens', async ({ app, page }) => {
  await app.openWithPicker(fixture('gp5/chords.gp5'));
  const name = 'chords.reprise';
  const before = await app.writeCount(name);
  await page.keyboard.press('ControlOrMeta+s');

  await app.waitForWrite(name, before);
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
