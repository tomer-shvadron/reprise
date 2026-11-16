import { read } from '@reprise/formats';

import { expect, test } from './test/app';

// Everything goes through the palette and the keys; browsers keep Ctrl+N, Ctrl+T and Ctrl+S for
// themselves, so New song and the bar dialog are reached from the palette (Save stays on its key,
// which the app swallows). The song: bars 1 to 7, a segno on 1, a repeat over 2 and 3 with two
// endings, a To Coda on 4, 3/4 on 5 and 6 with a D.S. al Coda on 6, and a coda on 7, at 240 BPM.
const PLAYED = ['1', '2', '3', '2', '4', '5', '6', '1', '2', '4', '7'].map((bar) => `${bar}/7`);

test('A song built from the UI saves with its structure and plays in order, one undo takes back a range edit', async ({
  app,
  page,
}) => {
  // Building seven bars through dialogs, two saves and a 10.5 s song, on a loaded runner.
  test.setTimeout(60_000);
  // Keys reach the page only once the palette has finished closing: until then its input has focus.
  const palette = async (text: string) => {
    await app.palette(text);
    await expect(page.getByPlaceholder('Type a command…')).toHaveCount(0);
  };
  await palette('New song');
  await app.waitReady();
  await expect(app.field('bar')).toHaveText('1/1');
  await app.gesture();

  for (let bar = 1; bar < 7; bar++) await palette('Insert bar after');
  await expect(app.field('bar')).toHaveText('1/7');

  const toBar = async (bar: number) => {
    await page.locator('body').focus();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let step = 1; step < bar; step++) await page.keyboard.press('ControlOrMeta+ArrowRight');
  };
  const dialogFor = async (title: string, open: () => Promise<void>) => {
    await open();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const apply = async (dialog: ReturnType<typeof page.getByRole>) => {
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
  };
  const properties = (title: string) => dialogFor(title, () => palette('Bar properties'));

  await toBar(1);
  const first = await properties('Bar 1');
  await first.getByLabel(/^Beats per minute/).fill('240');
  await first.getByLabel('Segno', { exact: true }).check();
  await apply(first);

  await toBar(2);
  await page.keyboard.press('[');

  await toBar(3);
  const third = await properties('Bar 3');
  await third.getByLabel('Repeat end').check();
  await third.getByRole('button', { name: 'Ending 1' }).click();
  await apply(third);

  await toBar(4);
  const fourth = await properties('Bar 4');
  await fourth.getByRole('button', { name: 'Ending 2' }).click();
  await fourth.getByLabel('Jump').selectOption({ label: 'To Coda' });
  await apply(fourth);

  await toBar(7);
  const seventh = await dialogFor('Bar 7', async () => {
    await page.keyboard.press('d');
  });
  await seventh.getByLabel('Coda', { exact: true }).check();
  await apply(seventh);

  // The last edit, so one undo takes exactly this one back.
  await toBar(5);
  await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
  const range = await properties('Bars 5–6');
  await range.getByLabel('Beats per bar').fill('3');
  await range.getByLabel('Continue until the next change').uncheck();
  await range.getByLabel('Jump').selectOption({ label: 'D.S. al Coda' });
  await apply(range);

  const saved = async (before: number) => {
    await page.locator('body').focus();
    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog', { name: 'Save as' });
    if (before === 0) await dialog.getByRole('button', { name: 'Reprise', exact: true }).click();
    await app.waitForWrite('Untitled.reprise', before);
    return (await read(await app.readStored('Untitled.reprise'), 'reprise')).score.masterBars;
  };

  const bars = await saved(0);
  expect(bars).toHaveLength(7);
  expect(bars[0]).toMatchObject({ tempo: { bpm: 240 }, targets: ['segno'] });
  expect(bars[1]?.repeat).toEqual({ start: true, endCount: 0 });
  expect(bars[2]).toMatchObject({ repeat: { start: false, endCount: 2 }, alternateEndings: [1] });
  expect(bars[3]).toMatchObject({ alternateEndings: [2], jumps: [{ kind: 'toCoda' }] });
  expect(bars.map((bar) => bar.timeSignature.numerator)).toEqual([4, 4, 4, 4, 3, 3, 4]);
  expect(bars[5]?.jumps).toEqual([{ kind: 'dsAlCoda' }]);
  expect(bars[6]).toMatchObject({ targets: ['coda'], jumps: [] });

  await page.locator('body').focus();
  const trail = app.barsUntilStopped();
  await page.keyboard.press('Shift+Space');
  const { bars: heard, timedOut } = await trail;
  expect(heard).toEqual(PLAYED);
  expect(timedOut).toBe(false);

  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+z');
  const undone = await saved(1);
  expect(undone.map((bar) => bar.timeSignature.numerator)).toEqual([4, 4, 4, 4, 4, 4, 4]);
  expect(undone[5]?.jumps).toEqual([]);
  expect(undone[6]).toMatchObject({ targets: ['coda'] });
});
