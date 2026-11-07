import { centre, expect, test } from './test/app';
import { SONG, generated } from './test/scores';

const CURSOR = '[data-playhead] .score-cursor';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('a loop made by dragging over two bars wraps', async ({ app, page }) => {
  const bar2 = await app.barBox(2);
  const bar3 = await app.barBox(3);

  await app.dragContent(centre(bar2), centre(bar3));
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: 'Loop bars 2–3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const trail = app.barTrail('3/16', '2/16', 2);
  await page.keyboard.press('Space');
  const { bars, timedOut } = await trail;
  expect(timedOut).toBe(false);
  for (const bar of bars) expect(['2/16', '3/16']).toContain(bar);
});

test('the bar keys step through a repeat', async ({ app, page }) => {
  const press = (key: string) => page.keyboard.press(key);
  const at = async (bar: string, time?: string) => {
    await expect(app.field('bar')).toHaveText(bar);
    if (time !== undefined) await expect(app.field('time')).toHaveText(`${time} ${SONG.total}`);
  };

  await press('ControlOrMeta+Home');
  await at('1/16');
  for (let i = 0; i < 7; i += 1) await press('ControlOrMeta+ArrowRight');
  await at('8/16', SONG.bar8First);
  await press('ControlOrMeta+ArrowRight');
  await at('1/16', SONG.bar1Second);
  await press('ControlOrMeta+ArrowLeft');
  await at('8/16', SONG.bar8First);
  await press('ControlOrMeta+End');
  await at('16/16');

  await press('ControlOrMeta+Home');
  await at('1/16');
  const start = (await app.contentBox(CURSOR)).x;
  let x = start;
  for (let step = 0; step < 2; step += 1) {
    await press('ArrowRight');
    await expect.poll(async () => (await app.contentBox(CURSOR)).x).toBeGreaterThan(x);
    x = (await app.contentBox(CURSOR)).x;
  }
  // The song moves in eighths, so two steps reach the second quarter.
  await expect(app.field('beat')).toHaveText('2/4');
  await press('Home');
  await expect(app.field('beat')).toHaveText('1/4');
  expect((await app.contentBox(CURSOR)).x).toBeCloseTo(start, 0);
});

test('a click seeks to a bar or a beat, and a repeated bar to the pass nearest the playhead', async ({
  app,
  page,
}) => {
  const bar2 = await app.barBox(2);
  const bar4 = await app.barBox(4);
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  await app.barBox(2);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(app.field('beat')).toHaveText('2/4');
  const beat2 = (await app.contentBox(CURSOR)).x;

  await page.keyboard.press('ControlOrMeta+Home');
  await app.clickContent({ x: bar4.x + 4, y: middle(bar4) });
  await expect(app.field('bar')).toHaveText('4/16');

  await page.keyboard.press('ControlOrMeta+Home');
  await app.clickContent({ x: beat2 + 1, y: middle(bar2) });
  await expect(app.field('bar')).toHaveText('2/16');
  await expect(app.field('beat')).toHaveText('2/4');
  expect(Math.abs((await app.contentBox(CURSOR)).x - beat2)).toBeLessThanOrEqual(1);

  await page.keyboard.press('ControlOrMeta+Home');
  await app.nextBars(10);
  await expect(app.field('bar')).toHaveText('3/16');
  await app.clickContent({ x: bar2.x + 4, y: middle(bar2) });
  await expect(app.field('bar')).toHaveText('2/16');
  await expect(app.field('time')).toHaveText(`${SONG.bar2Second} ${SONG.total}`);

  // Bar 3 shares bar 2's system, so the click needs no scroll from either pass.
  await page.keyboard.press('ControlOrMeta+Home');
  await app.nextBars(2);
  await expect(app.field('bar')).toHaveText('3/16');
  await app.clickContent({ x: bar2.x + 4, y: middle(bar2) });
  await expect(app.field('bar')).toHaveText('2/16');
  await expect(app.field('time')).toHaveText(`${SONG.bar2First} ${SONG.total}`);
});
