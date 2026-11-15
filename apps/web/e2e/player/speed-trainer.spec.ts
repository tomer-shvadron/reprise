import { centre, expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('ramps a looped bar up to the target, step by step', async ({ app, page }) => {
  // Bars 5 and 6 are in 3/4: a pass takes 4 s at 90 BPM.
  await app.dragContent(centre(await app.barBox(5)), centre(await app.barBox(6)));
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: 'Loop bars 5–6' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await app.palette('Show speed trainer');
  const panel = page.getByRole('region', { name: 'Speed trainer' });
  await expect(panel).toBeVisible();
  const set = async (name: string, value: string) => {
    const field = panel.getByRole('textbox', { name, exact: true });
    await field.fill(value);
    await field.press('Enter');
    await field.blur();
  };
  await set('Start', '100');
  await set('Step', '10');
  await set('Target', '120');
  await set('Repetitions per step', '1');

  await page.keyboard.press('Alt+S');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await app.expectSound();
  // The three passes take about 11 s.
  await expect(panel.getByText('Step 2 of 3')).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('Target reached')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Tempo in BPM' })).toHaveValue('108');
  // The loop keeps playing at the target.
  await app.expectSound();
});
