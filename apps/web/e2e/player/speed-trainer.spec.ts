import { centre, expect, test } from './test/app';
import { generated } from './test/scores';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated('song.gp'));
});

test('ramps a looped bar up to the target, step by step', async ({ app, page }) => {
  // Bar 5 is in 3/4: a pass takes 2 s at 90 BPM. A drag inside one bar selects just that bar.
  const bar = await app.barBox(5);
  const middle = centre(bar).y;
  await app.dragContent(
    { x: bar.x + bar.width * 0.3, y: middle },
    { x: bar.x + bar.width * 0.7, y: middle },
  );
  await page.keyboard.press('F9');
  await expect(page.getByRole('button', { name: /^Loop bars? 5/ })).toHaveAttribute(
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
  // The target is reached after two passes; the third completes the run, about 6 s in all.
  await expect(panel.getByText('Step 2 of 3')).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('Target reached')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Tempo in BPM' })).toHaveValue('108');
  // The loop keeps playing at the target.
  await app.expectSound();
});
