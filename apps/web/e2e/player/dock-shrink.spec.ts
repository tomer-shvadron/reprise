import { expect, test } from './test/app';
import { generated } from './test/scores';

test.use({ viewport: { width: 800, height: 600 } });

test('a dock at its maximum height gives way before the transport is clipped', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  await app.palette('Toggle fretboard');
  const handle = page.getByRole('separator', { name: 'Resize bottom panel' });
  await handle.focus();
  for (let i = 0; i < 40; i++) await handle.press('ArrowUp');
  await expect(handle).toHaveAttribute('aria-valuenow', '480');

  const transport = await page.locator('footer[aria-label="Transport"]').boundingBox();
  expect(transport).not.toBeNull();
  expect((transport?.y ?? 0) + (transport?.height ?? 0)).toBeLessThanOrEqual(600);
  const score = await page.getByRole('main', { name: 'Score' }).boundingBox();
  expect(score?.height).toBeGreaterThanOrEqual(160);
});
