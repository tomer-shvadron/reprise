import { readFileSync } from 'node:fs';

import { read } from '@reprise/formats';

import { expect, test } from '../player/test/app';
import { saveAndRead } from './test/editor';
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
