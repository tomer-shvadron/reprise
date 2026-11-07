import { expect, test } from './test/app';
import { generated } from './test/scores';

const BARS = 48;
const bar = (n: number) => `${String(n)}/${String(BARS)}`;
const CURSOR = '[data-playhead] .score-cursor';

test.beforeEach(async ({ app, page }) => {
  await app.openWithPicker(generated('song48.gp'));
  const bpm = page.getByRole('textbox', { name: 'Tempo in BPM' });
  await bpm.fill('180');
  await bpm.press('Enter');
  await expect(page.getByRole('slider', { name: 'Speed' })).toHaveAttribute('aria-valuenow', '200');
});

test('paged view follows the playhead with page turns', async ({ app, page }) => {
  await page.keyboard.press('ControlOrMeta+Home');
  const cursor = page.locator(CURSOR);
  // Bars 1 to 8 come first on the first pass; ⌘→ from bar 8 repeats bar 1.
  const FIRST_PASS = 8;
  const tops: number[] = [];
  let start = 0;
  for (let n = 1; n <= FIRST_PASS; n += 1) {
    await expect(app.field('bar')).toHaveText(bar(n));
    tops.push((await app.contentBox(CURSOR)).y);
    // A start in the lower part of the view, wholly visible, so the next system needs a turn.
    const box = await cursor.boundingBox();
    const { rect } = await app.regionScroll();
    const bottom = box ? box.y + box.height - rect.y : 0;
    if (start === 0 && bottom > rect.height * 0.6 && bottom <= rect.height) start = n;
    if (n < FIRST_PASS) await page.keyboard.press('ControlOrMeta+ArrowRight');
  }
  expect(start, 'no bar of the first 8 sits low in the view').toBeGreaterThan(0);
  // One bar into the next system: unfollowed, the line has left the view by then.
  const next = tops.findIndex((top, index) => index >= start && top > (tops[start - 1] ?? 0)) + 1;
  expect(next, `no system after bar ${String(start)}'s in the first pass`).toBeGreaterThan(start);
  const until = next + 1;
  expect(until).toBeLessThanOrEqual(FIRST_PASS);

  await page.keyboard.press('ControlOrMeta+Home');
  for (let n = 1; n < start; n += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(app.field('bar')).toHaveText(bar(start));
  await app.settle();
  const watch = app.watchFollow(bar(until));
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
