import { expect, test } from './test/app';
import { generated } from './test/scores';

test('the Chords tab lists shapes for a typed chord and plays one', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'Chords' })
    .click();
  await expect(page.getByRole('tab', { name: 'Chords' })).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('region', { name: 'Chord shapes' });
  await panel.getByLabel('Chord', { exact: true }).fill('Am');
  const first = panel.getByRole('button', { name: /^Am, open position: x 0 2 2 1 0/ });
  await expect(first).toBeVisible();
  await first.click();
  await expect(panel.getByRole('status')).toHaveCount(0);

  await panel.getByLabel('Chord', { exact: true }).fill('Cfoo');
  await expect(panel.getByText('No shapes for this chord name')).toBeVisible();
});
