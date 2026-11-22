import { expect, test } from './test/app';
import type { App } from './test/app';
import { generated, INSIGHTS } from './test/scores';

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
    // The palette, not the key: Home stays with a focused control such as a switch.
    await app.palette('First bar');
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
  const board = page.getByRole('tabpanel', { name: 'Fretboard' });
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

/** Plays from the first bar until the readout reaches `until`, and returns the frame gaps seen. */
async function playFromStart(app: App, until: string) {
  await app.palette('First bar');
  await expect(app.field('bar')).toHaveText(/^1\//);
  const watch = app.watchFrames(until);
  await app.playButton.click();
  await expect(app.playButton).toHaveAccessibleName('Pause');
  const result = await watch;
  await app.playButton.click();
  await expect(app.playButton).toHaveAccessibleName('Play');
  return result;
}

test('the arpeggio following the chords adds no frame gaps to the open fretboard', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated(INSIGHTS.file));
  await app.palette('Toggle fretboard');
  const board = page.getByRole('tabpanel', { name: 'Fretboard' });
  await expect(board.getByRole('group', { name: /fretboard$/ })).toBeVisible();

  // The same two bars on the same page, which cross the Am to F change: first with the fretboard
  // alone, then with the arpeggio on and following, which looks a chord up on every frame.
  const open = await playFromStart(app, '3/12');
  await app.palette('Toggle arpeggio on the fretboard');
  // The first run stopped on a later bar, so any of the song's chords means the lookup answered.
  await expect(board.locator('[data-arpeggio-chip]')).toHaveText(/^Arpeggio: (Am|F|C|G)$/);
  const following = await playFromStart(app, '3/12');

  console.info(`fretboard open: ${JSON.stringify(open)}`);
  console.info(`fretboard with the arpeggio following: ${JSON.stringify(following)}`);
  for (const run of [open, following]) expect(run.timedOut).toBe(false);
  // This score's chord is struck four times a bar, so the lit set changes once a bar.
  expect(following.changes).toBeGreaterThan(0);
  expect(following.steadyMaxGap).toBeLessThan(MAX_FRAME_GAP_MS);
  expect(following.steadyMaxGap).toBeLessThan(open.steadyMaxGap + MARGIN_MS);
});

test('the arpeggio overlay shows the chord of the bar the playhead is on', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated(INSIGHTS.file));
  await app.palette('Toggle arpeggio on the fretboard');
  const board = page.getByRole('tabpanel', { name: 'Fretboard' });
  const chip = board.locator('[data-arpeggio-chip]');
  // The analysis runs in a worker: the chip says so until the chords are in.
  await expect(chip).toHaveText(/^Arpeggio: Am/);
  const layer = board.locator('[data-fretboard-arpeggio]');
  await expect(layer).toHaveAccessibleName('Am chord tones: A R, C ♭3, E 5');

  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(app.field('bar')).toHaveText(/^2\//);
  await expect(chip).toHaveText(/^Arpeggio: F/);
  await expect(layer).toHaveAccessibleName('F chord tones: F R, A 3, C 5');

  // Holding a chord from the picker leaves the chip on it as the playhead moves on.
  await board.getByRole('button', { name: 'Choose an arpeggio' }).click();
  await page.getByRole('switch', { name: 'Follow chord changes' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(app.field('bar')).toHaveText(/^3\//);
  await expect(chip).toHaveText(/^Arpeggio: F · held/);

  await board.getByRole('button', { name: 'Hide the arpeggio' }).click();
  await expect(layer).toHaveCount(0);
  await expect(board.getByRole('button', { name: 'Choose an arpeggio' })).toBeFocused();
});
