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
  for (const n of [2, 3, 4, 5]) boxes[n] = await app.barBox(n);
  await page.keyboard.press('ControlOrMeta+e');
  const status = page.getByTestId('edit-status');
  // Edit mode opens at the playhead, which the measuring left on bar 5.
  await expect(status).toContainText('Bar 5 · Beat 1');

  /**
   * The middle of the first fret number the painter drew inside `n`'s column, in score content
   * coordinates. A click there is on a note, where the column's middle may fall between staves.
   * The column is bounded in both directions: bars on later systems share their x span with the
   * first system's. Clicks scroll the region as the cursor follows, so the bounds are taken from
   * the scroll as it is now, and `clickContent` checks that the note is in view.
   */
  const note = async (n: number): Promise<Point> => {
    const box = boxes[n];
    if (box === undefined) throw new Error(`Bar ${String(n)} was not measured`);
    await app.settle();
    const { rect, left, top } = await app.regionScroll();
    const column = {
      left: rect.x + box.x - left,
      top: rect.y + box.y - top,
      right: rect.x + box.x - left + box.width,
      bottom: rect.y + box.y - top + box.height,
    };
    const found = await page.evaluate(
      (bounds) =>
        [...document.querySelectorAll('svg[data-system-id] text')]
          .filter((text) => /^\d+$/.test(text.textContent))
          .map((text) => text.getBoundingClientRect())
          .filter(
            (r) =>
              r.x >= bounds.left &&
              r.right <= bounds.right &&
              r.y >= bounds.top &&
              r.bottom <= bounds.bottom,
          )
          .map(({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 }))[0],
      column,
    );
    if (found === undefined) throw new Error(`No fret number in bar ${String(n)}`);
    return { x: found.x - rect.x + left, y: found.y - rect.y + top };
  };

  const where = status.locator('span').first();
  const notice = status.getByRole('status');
  const MORE_THAN_ONE = /^Copied (?!1 beat$)/;

  // A click in bar 3 puts the cursor on it, with a string, and Copy holds the one beat there.
  await app.clickContent(await note(3));
  await expect(where).toContainText(/Bar 3 · Beat \d+ · String \d/);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(notice).toHaveText('Copied 1 beat');

  // Shift+click on bar 5, on the next system, makes a range from there: Copy holds more.
  await app.clickContent(await note(3));
  await expect(notice).toHaveText('');
  await page.keyboard.down('Shift');
  await app.clickContent(await note(5));
  await page.keyboard.up('Shift');
  await expect(where).toContainText('Bar 5 ·');
  await expect(page.locator('.score-range').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(notice).toHaveText(MORE_THAN_ONE);

  // A drag from bar 2 to bar 4, across the systems, makes a range of its own.
  await app.clickContent(await note(3));
  await expect(notice).toHaveText('');
  await app.dragContent(await note(2), await note(4));
  await expect(where).toContainText('Bar 4 ·');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(notice).toHaveText(MORE_THAN_ONE);

  // A click again, and the arrows step from where it landed: one right moves on, one left is back.
  await app.clickContent(await note(3));
  await expect(where).toContainText('Bar 3 ·');
  const landed = await where.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(where).not.toHaveText(landed ?? '');
  await page.keyboard.press('ArrowLeft');
  await expect(where).toHaveText(landed ?? '');
});
