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

  // Letters type a note near the one before it (the middle line to begin with), and A does not
  // open the chord name field here.
  await page.keyboard.press('c');
  await expect(status).toContainText('C5');
  await app.expectSound();
  await page.keyboard.press('ArrowRight');
  for (const letter of ['d', 'e', 'f']) {
    await page.keyboard.press(letter);
    await page.keyboard.press('ArrowRight');
  }
  // The bar is full: the arrow appended a bar. G, then E with G and C added above it.
  await page.keyboard.press('g');
  await expect(status).toContainText('G5');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  await page.keyboard.press('Shift+G');
  await page.keyboard.press('Shift+C');
  await expect(status).toContainText('C6');
  await expect(page.getByRole('combobox')).toHaveCount(0);

  const save = () => savedToLibrary(app, () => page.keyboard.press('ControlOrMeta+s'));
  const bars = async () => shapeOf(await save()).tracks[1] ?? [];
  const pitches = (bar: Awaited<ReturnType<typeof bars>>[number] | undefined) =>
    bar?.voices[0]?.beats.map(({ notes }) => notes.map((note) => note.fret));
  const saved = await bars();
  expect(pitches(saved[0])).toEqual([[72], [74], [76], [77]]);
  expect(pitches(saved[1])).toEqual([[79], [76, 79, 84]]);

  // One undo takes back one note.
  await page.keyboard.press('ControlOrMeta+z');
  expect(pitches((await bars())[1])).toEqual([[79], [76, 79]]);
});
