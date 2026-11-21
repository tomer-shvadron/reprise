import { centre, expect, test } from './test/app';
import { generated, SECTIONS } from './test/scores';

// The PNG signature, then the IHDR chunk's width and height (big-endian).
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test('Export as image writes a 2x PNG of page 1 through the save dialog, under the production CSP', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated(SECTIONS.file));
  await app.palette('Export as image');
  const dialog = page.getByRole('dialog', { name: 'Export as image' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /^Page/ }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect.poll(async () => (await app.saves()).length).toBe(1);
  const [save] = await app.saves();
  const name = save?.suggestedName ?? '';
  expect(name).toMatch(/ p1@2x\.png$/);
  await expect.poll(() => app.writeCount(name)).toBeGreaterThan(0);
  const bytes = await app.readStored(name);
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  // A4 at 96 dpi is 794 x 1123 CSS px; 2x doubles it.
  expect(pngSize(bytes)).toEqual({ width: 1588, height: 2246 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/^Exported 1 image\./)).toBeVisible();
});

test('Export as image writes an SVG with no fonts or CSS in it', async ({ app, page }) => {
  await app.openWithPicker(generated(SECTIONS.file));
  await app.palette('Export as image');
  const dialog = page.getByRole('dialog', { name: 'Export as image' });
  await dialog.getByRole('radio', { name: 'SVG' }).check();
  await dialog.getByRole('radio', { name: /^Page/ }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(async () => (await app.saves()).length).toBe(1);
  const name = (await app.saves())[0]?.suggestedName ?? '';
  expect(name).toMatch(/\.svg$/);
  await expect.poll(() => app.writeCount(name)).toBeGreaterThan(0);
  const svg = new TextDecoder().decode(await app.readStored(name));
  expect(svg).toMatch(/^<\?xml/);
  expect(svg).not.toMatch(/currentColor|oklch|@font-face/);
});

test('Copy bar as image puts a 2x PNG on the system clipboard', async ({
  app,
  context,
  page,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL ?? '' });
  await app.openWithPicker(generated(SECTIONS.file));
  const at = centre(await app.barBox(2));
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Copy bar as image/ }).click();
  await expect(page.getByText(/^Copied 1 bar as an image\./)).toBeVisible();
  const clipped = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item?.getType('image/png');
    if (!blob) return undefined;
    const bitmap = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, width: bitmap.width, height: bitmap.height };
  });
  expect(clipped?.type).toBe('image/png');
  expect(clipped?.size).toBeGreaterThan(500);
  // A one-bar crop is the bar's width plus margins, at 2x; never a whole page.
  expect(clipped?.width).toBeGreaterThan(200);
  expect(clipped?.height).toBeLessThan(2246);
});
