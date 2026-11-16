import { read } from '@reprise/formats';

import { expect, test, type App } from './test/app';
import { expectedScore, riff } from './test/riff';
import { shapeOf } from './test/score-shape';

const saved = async (app: App, name: string, press: () => Promise<void>) => {
  const before = await app.writeCount(name);
  await press();
  await app.waitForWrite(name, before);
  return (await read(await app.readStored(name), 'reprise')).score;
};

test('A sixteen-bar riff is entered from the keyboard alone, one undo step per entry', async ({
  app,
  page,
}) => {
  const r = riff();
  const bars = r.bars;
  expect(bars).toHaveLength(16);
  const status = page.getByTestId('edit-status');
  // Radix keeps the palette mounted through its close animation, with the input focused, where
  // the dispatcher leaves bare keys to the field. Focus must come back to the page or the score.
  const palette = async (text: string) => {
    await app.palette(text);
    await expect(page.getByRole('combobox')).toBeHidden();
    await expect
      .poll(() =>
        app
          .score()
          .evaluate(
            (region) =>
              document.activeElement === document.body || region.contains(document.activeElement),
          ),
      )
      .toBe(true);
  };

  // New song opens in edit mode; the shortcut turns it off and on again.
  await palette('New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toBeVisible();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(status).toBeHidden();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Bar 1 · End of bar · String 1');

  let heard = false;
  for (const step of r.steps) {
    if ('toggleInsert' in step) {
      await palette('Toggle insert mode');
      await expect(status).toContainText(step.toggleInsert);
      continue;
    }
    await page.keyboard.press(step.press);
    if (step.pending !== undefined) {
      await expect(status).toContainText(`Fret ${step.pending}…`);
    }
    if (!heard && /^\d$/.test(step.press)) {
      // The very first digit of the riff is heard through the preview.
      await app.expectSound();
      heard = true;
    }
  }
  // The riff ends on a committed fret, so no digit is waiting.
  await expect(status).not.toContainText('Fret ');
  expect(await app.description()).toBe('16 bars, 1 page');

  // A new song has no file, so the first Save is a Save As, which writes .reprise with no
  // question; Save writes in place after.
  const first = await saved(app, 'Untitled.reprise', () => page.keyboard.press('ControlOrMeta+s'));
  expect(shapeOf(first)).toEqual(shapeOf(expectedScore(bars)));

  const save = () => saved(app, 'Untitled.reprise', () => page.keyboard.press('ControlOrMeta+s'));
  const undo = async (times: number) => {
    for (let i = 0; i < times; i += 1) await page.keyboard.press('ControlOrMeta+z');
  };

  // Each undo takes back exactly one entry: undoing to the end of bar 5 leaves bars 1 to 5.
  const barFive = r.entriesAtBarEnd[4] ?? 0;
  await undo(r.entries - barFive);
  expect(shapeOf(await save())).toEqual(shapeOf(expectedScore(bars.slice(0, 5))));

  // All but one leaves the first beat alone; one more leaves the empty start score.
  await undo(barFive - 1);
  expect(shapeOf(await save())).toEqual(
    shapeOf(expectedScore([{ 0: [{ rhythm: '2', notes: [[6, 0]] }] }])),
  );
  await undo(1);
  expect(shapeOf(await save())).toEqual(shapeOf(expectedScore([{}])));
});
