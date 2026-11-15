import { expect, test } from './test/app';
import { generated } from './test/scores';

/** Frames of 60 Hz are 16.7 ms apart; headless Chromium on a shared runner jitters more. */
const MAX_FRAME_GAP_MS = 100;
/** What the fretboard may add to the same playback without it, on the same page. */
const MARGIN_MS = 50;

test('the fretboard follows playback without frame gaps beyond the baseline', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));

  const play = async () => {
    await page.keyboard.press('ControlOrMeta+Home');
    await expect(app.field('bar')).toHaveText(/^1\//);
    const watch = app.watchFrames('3/16');
    await app.playButton.click();
    await expect(app.playButton).toHaveAccessibleName('Pause');
    const result = await watch;
    await app.playButton.click();
    await expect(app.playButton).toHaveAccessibleName('Play');
    return result;
  };

  // The same two bars twice on one page: first with the fretboard closed, as the baseline for
  // the start-up stall every playback has (engine start, first schedule, sample decode), then
  // with it open. Only gaps after the readout starts moving are held to the budget.
  const baseline = await play();
  await app.palette('Toggle fretboard');
  const board = page.getByRole('region', { name: 'Fretboard' });
  await expect(board.getByRole('group', { name: /fretboard$/ })).toBeVisible();
  await expect(board.getByText(/6 strings, tuning E A D G B E/)).toBeVisible();
  const open = await play();

  console.info(`fretboard baseline (closed): ${JSON.stringify(baseline)}`);
  console.info(`fretboard open: ${JSON.stringify(open)}`);
  for (const run of [baseline, open]) expect(run.timedOut).toBe(false);
  expect(open.changes).toBeGreaterThan(4);
  expect(open.steadyMaxGap).toBeLessThan(MAX_FRAME_GAP_MS);
  expect(open.steadyMaxGap).toBeLessThan(baseline.steadyMaxGap + MARGIN_MS);
});
