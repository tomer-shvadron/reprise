import { palette } from '../editor/test/editor';
import { expect, test } from './test/app';
import { generated } from './test/scores';

const caps = (page: import('@playwright/test').Page) =>
  page.locator('[data-slot=tooltip-content] [data-slot=kbd]');

test('the tempo field shows its key on hover, and never opens on focus', async ({ app, page }) => {
  await app.openWithPicker(generated('song.gp'));
  const field = page.getByRole('textbox', { name: 'Tempo in BPM' });
  await field.focus();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await field.blur();
  await field.hover();
  await expect(page.getByRole('tooltip')).toContainText('Quarter notes per minute');
  await expect(caps(page)).toHaveCount(2);
});

test('the panel fold button has a label-only tooltip, and the next rail button opens its own', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('song.gp'));
  const rail = page.getByRole('group', { name: 'Panel rail' });
  await rail.getByRole('button', { name: 'Right panel' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Expand panel');
  await expect(caps(page)).toHaveCount(0);
  await page.mouse.move(300, 300, { steps: 10 });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Mixer' }).hover();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Mixer' })).toBeVisible();
  // Ten steps keep Radix's grace area from holding the first tooltip open over the neighbour.
  const next = await rail.getByRole('button', { name: 'Practice' }).boundingBox();
  if (!next) throw new Error('no Practice button');
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 10 });
  await expect(page.getByRole('tooltip').filter({ hasText: 'Practice' })).toBeVisible();
});

test('Undo in the History panel shows its key and still undoes on a click', async ({
  app,
  page,
}) => {
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'History' })
    .click();
  await page.keyboard.press('1');
  const undo = page.getByRole('button', { name: /^Undo / });
  await expect(undo).toBeEnabled();
  await undo.hover();
  await expect(page.getByRole('tooltip')).toContainText('Undo');
  await expect(caps(page)).toHaveCount(2);
  await undo.click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
