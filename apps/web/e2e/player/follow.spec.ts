import { expect, test } from './test/app';
import { generated } from './test/scores';

const BARS = 48;
const bar = (n: number) => `${String(n)}/${String(BARS)}`;

test.beforeEach(async ({ app, page }) => {
  await app.openWithPicker(generated('song48.gp'));
  const bpm = page.getByRole('textbox', { name: 'Tempo in BPM' });
  await bpm.fill('180');
  await bpm.press('Enter');
  await expect(page.getByRole('slider', { name: 'Speed' })).toHaveAttribute('aria-valuenow', '200');
});

test('paged view follows the playhead with page turns', async ({ app, page }) => {
  await page.keyboard.press('ControlOrMeta+Home');
  // A start in the lower part of the view, wholly visible, so the next system needs a turn.
  const cursor = page.locator('[data-playhead] .score-cursor');
  let start = 1;
  // Bars 1 to 8 come first on the first pass; ⌘→ from bar 8 repeats bar 1.
  for (; start <= 8; start += 1) {
    await expect(app.field('bar')).toHaveText(bar(start));
    await app.settle();
    const box = await cursor.boundingBox();
    const { rect } = await app.regionScroll();
    const bottom = box ? box.y + box.height - rect.y : 0;
    if (bottom > rect.height * 0.6 && bottom <= rect.height) break;
    await page.keyboard.press('ControlOrMeta+ArrowRight');
  }
  expect(start, 'no bar of the first 8 sits low in the view').toBeLessThanOrEqual(8);

  const watch = app.watchFollow(bar(start + 3));
  await page.keyboard.press('Space');
  const { outside, top, timedOut, frames, firstOutside } = await watch;
  expect(timedOut).toBe(false);
  expect(frames).toBeGreaterThan(0);
  expect(outside, JSON.stringify(firstOutside)).toBe(0);
  expect(top[1]).toBeGreaterThan(top[0]);
});

test('continuous view follows the playhead by scrolling', async ({ app, page }) => {
  await app.palette('Toggle page and continuous view');
  await expect.poll(() => app.description()).toBe(`${String(BARS)} bars`);
  await expect
    .poll(() => app.score().evaluate((region) => region.scrollWidth > region.clientWidth))
    .toBe(true);

  await page.keyboard.press('ControlOrMeta+Home');
  await expect(app.field('bar')).toHaveText(bar(1));
  const watch = app.watchFollow(bar(5));
  await page.keyboard.press('Space');
  const { outside, top, left, timedOut, firstOutside } = await watch;
  expect(timedOut).toBe(false);
  expect(outside, JSON.stringify(firstOutside)).toBe(0);
  expect(left[1]).toBeGreaterThan(left[0]);
  expect(top[1]).toBe(top[0]);

  await page.keyboard.press('Space');
  await page.keyboard.press('F4');
  await expect.poll(() => app.description()).toMatch(/^48 bars, \d+ pages$/);
});
