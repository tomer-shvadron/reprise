import { read } from '@reprise/formats';
import type { Score } from '@reprise/model';

import { expect, type App } from '../../player/test/app';

/**
 * Runs a palette command and returns once the keys reach the page, or the dialog the command
 * opened, again. Radix keeps the palette mounted through its close animation, with its input
 * focused, where the dispatcher leaves bare keys to the field: that input must be gone and
 * unfocused first.
 */
export async function palette(app: App, text: string): Promise<void> {
  await app.palette(text);
  await expect(app.page.locator('[cmdk-input]')).toHaveCount(0);
  await expect
    .poll(() => app.page.evaluate(() => document.activeElement?.hasAttribute('cmdk-input')))
    .toBe(false);
}

/**
 * A new song's first Save adds it to the library, so the file is `library/songs/<id>.reprise`;
 * later Saves write the same file. Runs `press` and reads the score the write left there.
 */
export async function savedToLibrary(app: App, press: () => Promise<void>): Promise<Score> {
  const [known] = await app.listStored('library/songs');
  const before = known === undefined ? 0 : await app.writeCount(known);
  await press();
  await expect.poll(() => app.listStored('library/songs')).toHaveLength(1);
  const [native = ''] = await app.listStored('library/songs');
  await app.waitForWrite(native, before);
  return (await read(await app.readStoredPath(`library/songs/${native}`), 'reprise')).score;
}

/** Save (the key) on a file opened in place, then the score read back from where it was opened. */
export async function saveAndRead(app: App, name: string): Promise<Score> {
  const before = await app.writeCount(name);
  await app.page.locator('body').focus();
  await app.page.keyboard.press('ControlOrMeta+s');
  await app.waitForWrite(name, before);
  return (await read(await app.readStored(name), 'reprise')).score;
}
