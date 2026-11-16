import { expect, test, type Box, type Point } from '../player/test/app';
import { generated } from '../player/test/scores';

// WP-080: in edit mode a click places the cursor, Shift extends a range and a drag makes one.
// The song is sixteen bars, so a bar's place on screen is read from the playhead's highlight.
test('The mouse places the cursor, extends a range and drags one, and the arrows step on from there', async ({
  app,
  page,
}) => {
  await app.stage(generated('song.reprise'));
  await app.pick('song.reprise');
  await app.palette('Open without importing');
  await app.waitReady('song.reprise');
  // The bars' places are read from the playhead, which the bar keys move only outside edit mode;
  // the score does not move when edit mode opens, so they hold after.
  const boxes: Record<number, Box> = {};
  for (const n of [2, 3, 5]) boxes[n] = await app.barBox(n);
  await page.keyboard.press('ControlOrMeta+e');
  const status = page.getByTestId('edit-status');
  // Edit mode opens at the playhead, which the measuring left on bar 5.
  await expect(status).toContainText('Bar 5 · Beat 1');
  /**
   * The middle of the first fret number the painter drew in `n`'s column, in score content
   * coordinates: a click there is on a note, where the column's middle may fall between staves.
   */
  const note = async (n: number): Promise<Point> => {
    const box = boxes[n];
    if (box === undefined) throw new Error(`Bar ${String(n)} was not measured`);
    const found = await page.evaluate(
      ({ left, right }) =>
        [...document.querySelectorAll('svg text')]
          .filter((text) => /^\d+$/.test(text.textContent))
          .map((text) => text.getBoundingClientRect())
          .filter((rect) => rect.x >= left && rect.right <= right)
          .map(({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 }))[0],
      await (async () => {
        const start = await app.toViewport({ x: box.x, y: box.y + 1 });
        return { left: start.x, right: start.x + box.width };
      })(),
    );
    if (found === undefined) throw new Error(`No fret number in bar ${String(n)}`);
    const { rect, left, top } = await app.regionScroll();
    return { x: found.x - rect.x + left, y: found.y - rect.y + top };
  };

  const where = status.locator('span').first();
  const copied = async () => {
    // A copy leaves its notice behind, so a second one must be told from the first: clear it by moving.
    await page.keyboard.press('ControlOrMeta+c');
    await expect(status.getByRole('status')).toContainText('Copied');
    return (await status.getByRole('status').textContent()) ?? '';
  };

  // A click in bar 3 puts the cursor on it, with a string, and Copy holds the one beat there.
  await app.clickContent(await note(3));
  await expect(where).toContainText(/Bar 3 · Beat \d+ · String \d/);
  expect(await copied()).toBe('Copied 1 beat');

  // Shift+click on bar 5 makes a range from the cursor: Copy holds more than that beat.
  await app.clickContent(await note(3));
  await page.keyboard.down('Shift');
  await app.clickContent(await note(5));
  await page.keyboard.up('Shift');
  await expect(page.locator('.score-range').first()).toBeVisible();
  expect(await copied()).toMatch(/^Copied (?!1 beat$)/);

  // A drag over two bars makes a range of its own.
  await app.clickContent(await note(3));
  expect(await copied()).toBe('Copied 1 beat');
  await app.dragContent(await note(2), await note(3));
  await expect(where).toContainText(/Bar 3 ·/);
  expect(await copied()).toMatch(/^Copied (?!1 beat$)/);

  // A click again, and the arrows step from where it landed: one right moves on, one left is back.
  await app.clickContent(await note(3));
  await expect(where).toContainText('Bar 3 ·');
  const landed = await where.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(where).not.toHaveText(landed ?? '');
  await page.keyboard.press('ArrowLeft');
  await expect(where).toHaveText(landed ?? '');
});
