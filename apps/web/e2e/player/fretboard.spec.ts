import { expect, test } from './test/app';
import { generated } from './test/scores';

/** Frames of 60 Hz are 16.7 ms apart; headless Chromium on a shared runner jitters more. */
const MAX_FRAME_GAP_MS = 100;

test('the fretboard follows playback without dropping frames', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await app.palette('Toggle fretboard');
  const board = page.getByRole('region', { name: 'Fretboard' });
  await expect(board.getByRole('group', { name: /fretboard$/ })).toBeVisible();
  await expect(board.getByText(/6 strings, tuning E A D G B E/)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(app.field('bar')).toHaveText(/^1\//);

  const watch = app.watchFrames('3/16');
  await app.playButton.click();
  await expect(app.playButton).toHaveAccessibleName('Pause');
  const { frames, maxGap, medianGap, changes, timedOut } = await watch;
  console.info(
    `fretboard: ${String(frames)} frames over bars 1 to 3, median gap ${medianGap.toFixed(1)} ms, max gap ${maxGap.toFixed(1)} ms, ${String(changes)} lit changes`,
  );
  expect(timedOut).toBe(false);
  expect(changes).toBeGreaterThan(4);
  expect(maxGap).toBeLessThan(MAX_FRAME_GAP_MS);
});
