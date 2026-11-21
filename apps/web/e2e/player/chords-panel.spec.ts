import { expect, test } from './test/app';
import { generated } from './test/scores';

test('the Chords tab lists shapes for a typed chord and plays one', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await app.gesture();
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
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  // The strum goes through the engine's previewNote, whose string and fret checks run for real here.
  await app.expectSound();
  await expect(panel.getByRole('status')).toHaveText('');

  await panel.getByLabel('Chord', { exact: true }).fill('Cfoo');
  await expect(panel.getByRole('status')).toHaveText('No shapes for this chord name');
});

test('every tab stays reachable at the panel minimum width', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'Chords' })
    .click();
  const handle = page.getByRole('separator', { name: 'Resize panel' });
  await handle.focus();
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '240');
  const list = page.getByRole('tablist', { name: 'Panel views', exact: true });
  await expect(list.getByRole('tab')).toHaveCount(5);
  // The strip scrolls when the labels are wider than the panel; arrowing to the last tab brings it in view.
  await list.getByRole('tab', { name: 'Mixer' }).focus();
  await page.keyboard.press('End');
  const chords = list.getByRole('tab', { name: 'Chords' });
  await expect(chords).toBeFocused();
  const [tabBox, listBox] = await Promise.all([chords.boundingBox(), list.boundingBox()]);
  expect((tabBox?.x ?? 0) + (tabBox?.width ?? 0)).toBeLessThanOrEqual(
    (listBox?.x ?? 0) + (listBox?.width ?? 0) + 1,
  );
  await list.getByRole('tab', { name: 'Mixer' }).click();
  const mixerBox = await list.getByRole('tab', { name: 'Mixer' }).boundingBox();
  expect(mixerBox?.x ?? -1).toBeGreaterThanOrEqual((listBox?.x ?? 0) - 1);
});
