import type { Page } from '@playwright/test';

import { expect, test, type App } from './test/app';
import { SONG, generated } from './test/scores';

const within = (measured: number, expected: number, tolerance = 0.1) => {
  expect(measured).toBeGreaterThanOrEqual(expected * (1 - tolerance));
  expect(measured).toBeLessThanOrEqual(expected * (1 + tolerance));
};

/** Plays from the first bar, measures the beat interval over three beats, and pauses. */
async function measureBeat(app: App, page: Page): Promise<number> {
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(app.field('beat')).toHaveText('1/4');
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  const interval = await app.beatInterval(3);
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Play');
  return interval;
}

const barNumber = (text: string | null) => Number((text ?? '').split('/')[0]);

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('play, pause, resume, stop and play from start', async ({ app, page }) => {
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await expect(app.field('beat')).not.toHaveText('1/4');
  await app.expectSound();
  expect(await app.contexts()).toBe(1);
  expect((await app.level()).state).toBe('running');

  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Play');
  await app.expectSilence();
  const held = barNumber(await app.field('bar').textContent());
  expect(held).toBeGreaterThanOrEqual(1);

  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  expect(barNumber(await app.field('bar').textContent())).toBeGreaterThanOrEqual(held);

  await page.keyboard.press('Enter');
  await expect(app.playButton).toHaveAccessibleName('Play');
  await expect(app.field('bar')).toHaveText('1/16');
  await expect(app.field('beat')).toHaveText('1/4');
  await expect(app.field('time')).toHaveText(`0:00 ${SONG.total}`);
  await app.expectSilence();

  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(app.field('bar')).toHaveText('4/16');
  await page.keyboard.press('Shift+Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await expect(app.field('bar')).toHaveText('1/16');
});

test('tempo in BPM and percent', async ({ app, page }) => {
  const speed = page.getByRole('slider', { name: 'Speed' });
  const bpm = page.getByRole('textbox', { name: 'Tempo in BPM' });
  const relative = page.getByRole('button', { name: /^Relative speed / });

  const full = await measureBeat(app, page);
  within(full, SONG.quarterMs[100]);

  await bpm.fill('45');
  await bpm.press('Enter');
  await expect(speed).toHaveAttribute('aria-valuenow', '50');
  await expect(relative).toHaveAccessibleName('Relative speed 50%');
  const half = await measureBeat(app, page);
  within(half, SONG.quarterMs[50]);
  expect(half / full).toBeGreaterThanOrEqual(1.8);
  expect(half / full).toBeLessThanOrEqual(2.2);

  await page.keyboard.press('ControlOrMeta+F9');
  await expect(speed).toHaveAttribute('aria-valuenow', '100');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press(']');
  await expect(speed).toHaveAttribute('aria-valuenow', '150');
  await expect(bpm).toHaveValue('135');
  await expect(relative).toHaveAccessibleName('Relative speed 150%');
  within(await measureBeat(app, page), SONG.quarterMs[150]);
});

test('count-in', async ({ app, page }) => {
  const countIn = page.getByRole('button', { name: 'Count-in' });
  await page.keyboard.press('Alt+c');
  await expect(countIn).toHaveAttribute('aria-pressed', 'true');

  const clicks = app.peakWhile('beat', 'Count-in');
  await page.keyboard.press('Space');
  await expect(app.field('beat')).toHaveText('Count-in');
  await expect(app.field('time')).toHaveText(`0:00 ${SONG.total}`);
  expect(await clicks).toBeGreaterThan(1e-3);
  await expect(app.field('bar')).toHaveText('1/16');
  await expect(app.field('beat')).toHaveText(/^\d\/4$/);
  await expect(app.playButton).toHaveAccessibleName('Pause');
});
