import type { Score } from '@reprise/model';

import { expect, test } from '../player/test/app';
import { palette, quarters, saveKey, toBar, typeSong } from './test/editor';
import { shapeOf } from './test/score-shape';

type Bar = Score['tracks'][number]['bars'][number];

/** `[string, fret]` of every note, beat by beat, in the bar's first voice. */
const FRETS = (bar: Bar | undefined) =>
  bar?.voices[0]?.beats.map((beat) => beat.notes.map(({ string, fret }) => [string, fret]));

// WP-085: the Transpose dialog, the semitone keys and the string keys, and what happens when a
// note would fall off the neck: a refusal that changes nothing.
test('Transpose moves frets and chord names, the keys nudge and move notes, and a note off the neck is refused', async ({
  app,
  page,
}) => {
  const r = quarters([6, [0, 3, 5, 3]], [5, [0, 2, 3, 2]]);
  await typeSong(app, r);
  await palette(app, 'Show history');
  const rows = page.getByRole('region', { name: 'History' }).getByRole('option');
  const status = page.getByTestId('edit-status');
  const typed = 1 + r.entries;
  const rowCount = async (count: number) => {
    await expect(rows).toHaveCount(count);
    await expect(rows.last()).toHaveAttribute('aria-current', 'step');
  };

  // A chord name on the first beat, for the dialog to carry along.
  await toBar(app, 1);
  await page.keyboard.press('a');
  await page.keyboard.type('Am');
  await page.keyboard.press('Enter');
  await rowCount(typed + 1);

  const openDialog = async () => {
    await palette(app, 'Transpose…');
    const dialog = page.getByRole('dialog', { name: 'Transpose' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const selectBar1 = async () => {
    await toBar(app, 1);
    for (let beat = 0; beat < 3; beat += 1) await page.keyboard.press('Shift+ArrowRight');
  };

  // The open low E cannot go down two: the dialog stays, names the place, and nothing changes.
  const before = shapeOf(await saveKey(app));
  await selectBar1();
  let dialog = await openDialog();
  await dialog.getByLabel('Semitones').fill('-2');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/Track 1, bar 1, string 6/);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await rowCount(typed + 1);
  expect(shapeOf(await saveKey(app))).toEqual(before);

  // Up two: every fret in the range and the chord name move.
  await selectBar1();
  dialog = await openDialog();
  await dialog.getByLabel('Semitones').fill('2');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await rowCount(typed + 2);
  await expect(rows.last()).toHaveText('Transpose');
  await expect(page.locator('svg text', { hasText: /^Bm$/ })).toHaveCount(1);
  await expect(page.locator('svg text', { hasText: /^Am$/ })).toHaveCount(0);
  const transposed = await saveKey(app);
  expect(FRETS(transposed.tracks[0]?.bars[0])).toEqual([[[6, 2]], [[6, 5]], [[6, 7]], [[6, 5]]]);
  expect(transposed.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.chord?.name).toBe('Bm');

  // Alt+Shift+Up raises the one note under the cursor a semitone.
  await toBar(app, 2);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await rowCount(typed + 3);
  // Alt+Down moves the next note to the string below, keeping its pitch: string 5 fret 2 is string 6 fret 7.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+ArrowDown');
  await rowCount(typed + 4);
  await expect(status).toContainText('String 6');
  // ...and there is no string below that one.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(status.getByRole('status')).toContainText(
    'There is no string below string 6 in bar 2',
  );
  await rowCount(typed + 4);

  const moved = await saveKey(app);
  expect(FRETS(moved.tracks[0]?.bars[1])).toEqual([[[5, 1]], [[6, 7]], [[5, 3]], [[5, 2]]]);
});
