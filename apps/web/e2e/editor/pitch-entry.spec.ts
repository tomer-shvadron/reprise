import { expect, test } from '../player/test/app';
import { palette, savedToLibrary } from './test/editor';
import { shapeOf } from './test/score-shape';

// #221: a keyboard track's standard staff has its own key context. The letters A to G type a note
// where they would otherwise open the chord name field, and ⇧A to ⇧G add to the chord.
test('Pitches are typed by name on a keyboard track, one undo step each', async ({ app, page }) => {
  const status = page.getByTestId('edit-status');
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toBeVisible();

  await page.getByRole('button', { name: 'Add track' }).click();
  const add = page.getByRole('dialog', { name: 'Add track' });
  await add.getByRole('radio', { name: 'Pitched' }).click();
  await add.getByRole('button', { name: 'Add track' }).click();
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  // The lane starts on the middle line of the treble clef.
  await expect(status).toContainText('B4');

  // ↑ and ↓ walk the lane a line or space at a time.
  await page.keyboard.press('ArrowUp');
  await expect(status).toContainText('C5');

  // A types a note here (A4, the nearest to the middle line) and does not open the chord name
  // field; D and G would open Directions… and Grace note… on tab.
  await page.keyboard.press('a');
  await expect(status).toContainText('A4');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  // A plain letter replaces the note in the lane, so a typo is corrected by the right letter.
  await page.keyboard.press('b');
  await page.keyboard.press('c');
  await expect(status).toContainText('C5');
  await app.expectSound();
  await page.keyboard.press('ArrowRight');
  for (const letter of ['d', 'e']) {
    await page.keyboard.press(letter);
    await page.keyboard.press('ArrowRight');
  }
  await expect(status).toContainText('E5');
  // The bar is full: the arrow appended a bar. G, then E with G and C added above it.
  await page.keyboard.press('g');
  await expect(status).toContainText('G5');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  await page.keyboard.press('Shift+G');
  await page.keyboard.press('Shift+C');
  await expect(status).toContainText('C6');

  const save = () => savedToLibrary(app, () => page.keyboard.press('ControlOrMeta+s'));
  const bars = async () => shapeOf(await save()).tracks[1] ?? [];
  const pitches = (bar: Awaited<ReturnType<typeof bars>>[number] | undefined) =>
    bar?.voices[0]?.beats.map(({ notes }) => notes.map((note) => note.fret));
  const saved = await bars();
  expect(pitches(saved[0])).toEqual([[69], [72], [74], [76]]);
  expect(pitches(saved[1])).toEqual([[79], [76, 79, 84]]);

  // One undo takes back one note.
  await page.keyboard.press('ControlOrMeta+z');
  expect(pitches((await bars())[1])).toEqual([[79], [76, 79]]);
});

// #221, part C: a guitar shown as standard notation takes letters too, and the string is chosen.
test("A guitar's standard staff takes pitches, with the string chosen and movable", async ({
  app,
  page,
}) => {
  const status = page.getByTestId('edit-status');
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toBeVisible();
  await palette(app, 'Show current track as standard notation');
  await page.locator('body').focus();

  // E, F, G with → between them: the first note sits at the nut, then the hand stays put.
  for (const letter of ['e', 'f', 'g']) {
    await page.keyboard.press(letter);
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('String 1');
  await app.expectSound();
  // ⌥↓ moves the last note, G4, to the next string at the same pitch.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(status).toContainText('String 2');

  // A digit on that staff is a fret on the cursor's string, as before.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('5');
  await expect(status).toContainText('String 2');

  // A plain letter corrects the lone note of a beat even when it is on another string than the
  // cursor's: D replaces the F on string 1 rather than joining it as a chord.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('d');

  const saved = shapeOf(await savedToLibrary(app, () => page.keyboard.press('ControlOrMeta+s')));
  const beats = saved.tracks[0]?.[0]?.voices[0]?.beats ?? [];
  expect(beats.map(({ notes }) => notes.map((note) => [note.string, note.fret]))).toEqual([
    [[1, 0]],
    [[2, 3]],
    [[2, 8]],
    [[2, 5]],
  ]);
});
