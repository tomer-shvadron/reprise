import { expect, test } from './test/app';
import { generated, libraryFile, libraryTitle, SECTIONS } from './test/scores';

const bar = (n: number) => `${String(n)}/${String(SECTIONS.bars)}`;

test.describe('go-to-anything prefixes', () => {
  test.beforeEach(async ({ app }) => {
    await app.openWithPicker(generated(SECTIONS.file));
  });

  test('# with Cmd+Enter loops the second chorus and goes to its first bar', async ({
    app,
    page,
  }) => {
    await app.paletteAlt('#ch2');
    await expect(
      page.getByRole('button', { name: `Loop bars ${SECTIONS.chorus2Bars}` }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(app.field('bar')).toHaveText(bar(SECTIONS.starts.chorus2));
  });

  test('# with Enter goes to the first verse', async ({ app }) => {
    await app.palette('#verse');
    await expect(app.field('bar')).toHaveText(bar(SECTIONS.starts.verse1));
  });

  test('a number goes to that bar', async ({ app }) => {
    await app.palette('12');
    await expect(app.field('bar')).toHaveText(bar(12));
  });

  test('@ selects a track', async ({ app, page }) => {
    await app.palette('@rhythm');
    const tracks = page.getByRole('list', { name: 'Tracks' });
    await expect(tracks.getByRole('button', { name: /^Rhythm/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

test.describe('the library prefix', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.gesture();
    for (const n of [1, 2]) {
      await app.stage(generated(libraryFile(n)), libraryFile(n));
      await app.pick(libraryFile(n));
    }
    await app.palette('Import files to library');
    await expect(page.getByRole('status').filter({ hasText: /^Imported 2/ })).toBeVisible({
      timeout: 30_000,
    });
    // The import opens the Library sheet, and a palette needs no other dialog open.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Library' })).toHaveCount(0);
  });

  test('/ opens a library song, and asks before leaving an unsaved one', async ({ app, page }) => {
    await app.palette(`/${libraryTitle(2).toLowerCase()}`);
    await app.waitReady();
    await expect(page.getByRole('region', { name: `Score: ${libraryTitle(2)}` })).toBeVisible();

    await page.locator('body').focus();
    await page.keyboard.press('F6');
    const properties = page.getByRole('dialog', { name: 'Track properties' });
    await properties.getByLabel('Name', { exact: true }).fill('Renamed');
    await properties.getByRole('button', { name: 'Apply' }).click();

    await app.palette(`/${libraryTitle(1).toLowerCase()}`);
    const prompt = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('region', { name: `Score: ${libraryTitle(2)}` })).toBeVisible();
  });
});
