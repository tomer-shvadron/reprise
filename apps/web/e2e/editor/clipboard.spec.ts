import { readFileSync } from 'node:fs';

import { read } from '@reprise/formats';

import { expect, test } from '../player/test/app';
import {
  palette,
  quarters,
  saveKey,
  saveAndRead,
  toBar,
  typeSong,
  openHistory,
} from './test/editor';
import { shapeOf } from './test/score-shape';
import { generated } from '../player/test/scores';

// WP-084 acceptance: a cross-track paste of four bars is one undo step, the history panel shows it
// as one Paste row, and undo restores the score and puts the cursor back where the paste began.
test('A four-bar cross-track paste is one Paste row, and one undo restores the score and the cursor', async ({
  app,
  page,
}) => {
  const original = await read(readFileSync(generated('song.reprise')), 'reprise');
  const firstTrack = shapeOf(original.score).tracks[0]?.slice(0, 4);
  const secondTrack = shapeOf(original.score).tracks[1]?.slice(0, 4);
  expect(secondTrack).not.toEqual(firstTrack);

  await app.stage(generated('song.reprise'));
  await app.pick('song.reprise');
  await app.palette('Open without importing');
  await app.waitReady('song.reprise');

  const status = page.getByTestId('edit-status');
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Bar 1 ·');

  // Four bars of the first track: Shift+Mod+Right extends bar by bar.
  for (let bar = 0; bar < 3; bar += 1) await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(status).toContainText('Copied');

  // The second track at bar 1, through the sidebar, as a click does.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Home');
  await page
    .getByRole('list', { name: 'Tracks' })
    .getByRole('button', { name: /^Track 2/ })
    .click();
  await page.locator('body').focus();
  await expect(status).toContainText('Bar 1 ·');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(status).toContainText('Pasted');

  // The history panel lists the paste as one row.
  await app.palette('Show history');
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByRole('option')).toHaveText(['Opened', 'Paste']);
  await expect(history.getByRole('option', { name: 'Paste' })).toHaveAttribute(
    'aria-current',
    'step',
  );

  const savedShape = async () => shapeOf(await saveAndRead(app, 'song.reprise'));
  const pasted = await savedShape();
  expect(pasted.tracks[1]?.slice(0, 4)).toEqual(firstTrack);

  // Move the cursor away first (track 1, bar 4), so that coming back is the landing's doing: the
  // paste itself leaves it on the first pasted bar of track 2.
  const sidebar = page.getByRole('list', { name: 'Tracks' });
  await sidebar.getByRole('button', { name: /^Track 1/ }).click();
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let bar = 0; bar < 3; bar += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(status).toContainText('Bar 4 ·');
  await expect(sidebar.getByRole('button', { name: /^Track 1/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // One undo restores the second track, and the cursor is back at the start of the paste.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(history.getByRole('option', { name: 'Opened' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(status).toContainText('Bar 1 ·');
  await expect(sidebar.getByRole('button', { name: /^Track 2/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  const undone = await savedShape();
  expect(undone).toEqual(shapeOf(original.score));
});

// WP-084: a cut leaves rests where the beats were, Paste as insert makes room for what it carries,
// and Paste over refuses a bar it cannot fit in, naming the bar.
test('Cut leaves rests, Paste as insert adds bars, and Paste over a bar too short is refused', async ({
  app,
  page,
}) => {
  const r = quarters([6, [0, 3, 5, 3]], [5, [0, 2, 3, 2]]);
  await typeSong(app, r);
  const { rows, typed, rowCount } = await openHistory(app, r);
  const status = page.getByTestId('edit-status');

  // Cut of the first two beats: one Cut row, and a half rest, the length of the two beats.
  await toBar(app, 1);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+x');
  await expect(status).toContainText('Cut');
  await rowCount(typed + 1);
  await expect(rows.last()).toHaveText('Cut');
  const cut = await saveKey(app);
  const beats = cut.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
  expect(beats.map((beat) => [beat.rest, beat.duration])).toEqual([
    [true, 2],
    [false, 4],
    [false, 4],
  ]);

  // Paste over at the last beat of the bar (the half rest is one beat): two quarters do not fit, and the bar is named.
  await toBar(app, 1);
  for (let beat = 0; beat < 2; beat += 1) await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('Bar 1 · Beat 3');
  await palette(app, 'Paste over');
  await expect(status.getByRole('status')).toContainText(/^Bar 1 has .* left/);
  await rowCount(typed + 1);

  // Copy both bars and paste them as an insert at bar 2: the song grows by two bars.
  expect(await app.description()).toBe('2 bars, 1 page');
  await toBar(app, 1);
  await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(status).toContainText('Copied');
  await toBar(app, 2);
  await palette(app, 'Paste as insert');
  await expect.poll(() => app.description()).toBe('4 bars, 1 page');
  await rowCount(typed + 2);
  await expect(rows.last()).toHaveText('Paste');
  // The copied bars went in at bar 2, and the old bar 2 moved to the end.
  const inserted = await saveKey(app);
  const frets = (bar: number) =>
    inserted.tracks[0]?.bars[bar]?.voices[0]?.beats.map((beat) =>
      beat.rest ? 'rest' : beat.notes.map(({ string, fret }) => [string, fret]),
    );
  expect(frets(1)).toEqual(['rest', [[6, 5]], [[6, 3]]]);
  expect(frets(2)).toEqual([[[5, 0]], [[5, 2]], [[5, 3]], [[5, 2]]]);
  expect(frets(3)).toEqual(frets(2));
});
