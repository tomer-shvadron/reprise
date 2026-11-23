import { expect, test } from '../player/test/app';
import { palette, savedToLibrary } from './test/editor';
import { shapeOf } from './test/score-shape';

// #221: a drum track has a lane where a guitar has a string. Up and down move it through the kit,
// 0 places the drum the cursor is on, and 1 to 8 start a GM number.
test('Drums are entered by lane and by GM number, one undo step per hit', async ({ app, page }) => {
  const status = page.getByTestId('edit-status');
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toBeVisible();

  await page.getByRole('button', { name: 'Add track' }).click();
  const add = page.getByRole('dialog', { name: 'Add track' });
  await add.getByRole('radio', { name: 'Percussion' }).click();
  await add.getByRole('button', { name: 'Add track' }).click();
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(status).toContainText('Acoustic Snare (38)');

  // The lane moves up the kit and back.
  await page.keyboard.press('ArrowUp');
  await expect(status).toContainText('Hi-Mid Tom (48)');
  await page.keyboard.press('ArrowDown');
  await expect(status).toContainText('Acoustic Snare (38)');

  // 3 then 6 is the bass drum; the lane follows to it, so 0 repeats it.
  await page.keyboard.press('3');
  await expect(status).toContainText('Drum 3…');
  await page.keyboard.press('6');
  await expect(status).toContainText('Bass Drum 1 (36)');
  await app.expectSound();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('4');
  await page.keyboard.press('2');
  await expect(status).toContainText('Closed Hi-Hat (42)');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('0');
  await expect(status).not.toContainText('Drum ');

  const save = () => savedToLibrary(app, () => page.keyboard.press('ControlOrMeta+s'));
  const hits = (beats: readonly { notes: Record<string, unknown>[] }[]) =>
    beats.map(({ notes }) => notes.map((note) => [note.string, note.fret]));
  const drums = async () => shapeOf(await save()).tracks[1]?.[0]?.voices[0]?.beats ?? [];
  expect(hits(await drums())).toEqual([[[0, 36]], [[0, 36]], [[0, 42]], [[0, 42]]]);

  // One undo takes back exactly one hit.
  await page.keyboard.press('ControlOrMeta+z');
  expect(hits(await drums())).toEqual([[[0, 36]], [[0, 36]], [[0, 42]]]);
});
