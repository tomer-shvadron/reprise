import { read } from '@reprise/formats';
import type { Score } from '@reprise/model';

import { expect, type App } from '../../player/test/app';
import { Riff } from './riff';

/**
 * Runs a palette command and returns once the keys reach the page, or the dialog the command
 * opened, again. Radix keeps the palette mounted through its close animation, with its input
 * focused, where the dispatcher leaves bare keys to the field: that input must be gone first.
 * Not `getByRole('combobox')`: the dialogs a command opens hold `<select>` comboboxes of their own.
 */
export async function palette(app: App, text: string): Promise<void> {
  await app.palette(text);
  await expect(app.page.locator('[cmdk-input]')).toHaveCount(0);
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

/**
 * Bars of quarter notes, one string per bar: `quarters([6, [0, 3, 5, 3]], [5, [0, 2, 3, 2]])`.
 * Small enough that a spec can name every note it checks.
 */
export function quarters(...bars: ReadonlyArray<readonly [number, readonly number[]]>): Riff {
  const riff = new Riff();
  bars.forEach(([string, frets], index) => {
    if (index > 0) riff.nextBar();
    for (const fret of frets) riff.beat('4', [[string, fret]]);
  });
  return riff;
}

/** A new song from the palette with `riff` typed into it, the cursor left at the end of the last bar. */
export async function typeSong(app: App, riff: Riff): Promise<void> {
  const { page } = app;
  const status = page.getByTestId('edit-status');
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toContainText('Bar 1 · End of bar · String 1');
  for (const step of riff.steps) {
    if ('toggleInsert' in step) throw new Error('This helper does not type in insert mode');
    await page.keyboard.press(step.press);
    if (step.pending !== undefined) await expect(status).toContainText(`Fret ${step.pending}…`);
  }
}

/** The cursor on the first stop of `bar`, by the bar keys. */
export async function toBar(app: App, bar: number): Promise<void> {
  const { page } = app;
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let step = 1; step < bar; step += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect(page.getByTestId('edit-status')).toContainText(`Bar ${String(bar)} ·`);
}

/** Save (the key) to the library, as `savedToLibrary` reads it. */
export function saveKey(app: App): Promise<Score> {
  return savedToLibrary(app, async () => {
    await app.page.locator('body').focus();
    await app.page.keyboard.press('ControlOrMeta+s');
  });
}
