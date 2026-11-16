import { read } from '@reprise/formats';
import type { Score } from '@reprise/model';

import { expect, test } from '../player/test/app';
import { palette, savedToLibrary } from './test/editor';
import { Riff, expectedScore } from './test/riff';
import { shapeOf } from './test/score-shape';

/**
 * A four-bar riff: quarters on string 6 in bar 1 (the bar the effects go on by key) and on string
 * 5 in bar 2 (the range), then two more bars. `note-entry` proves the sixteen-bar entry.
 */
function riff(): Riff {
  const r = new Riff();
  for (const fret of [0, 3, 5, 3]) r.beat('4', [[6, fret]]);
  r.nextBar();
  for (const fret of [0, 2, 3, 2]) r.beat('4', [[5, fret]]);
  r.nextBar();
  for (const fret of [0, 3, 5, 3]) r.beat('4', [[4, fret]]);
  r.nextBar();
  for (const fret of [7, 5, 3, 0]) r.beat('4', [[3, fret]]);
  return r;
}

/**
 * The fields the chain's own steps set, named so the test can say what each step did: the effects
 * on each note, and the bar lines' repeats, which `shapeOf` does not look at. `shapeOf` holds
 * across gp for this riff (it already covers every note field), so it is the whole-score
 * comparison; this adds the repeats and the readable expectations on S1.
 */
function chosenFields(score: Score) {
  const [track] = score.tracks;
  return {
    bars: track?.bars.map((bar) =>
      bar.voices.map((voice) =>
        voice.beats.map((beat) => ({
          duration: beat.duration,
          rest: beat.rest,
          notes: beat.notes.map((n) => ({
            string: n.string,
            fret: n.fret,
            palmMute: n.palmMute,
            hammerPull: n.hammerPull,
            vibrato: n.vibrato,
            accent: n.accent,
            bend: n.bend?.kind,
            bendHeight: Math.max(0, ...(n.bend?.points.map((p) => p.value) ?? [])),
          })),
        })),
      ),
    ),
    repeats: score.masterBars.map((bar) => bar.repeat),
  };
}

test('A song typed in the app takes effects, bars and a paste, survives undo and redo, and round-trips through gp', async ({
  app,
  page,
}) => {
  const r = riff();
  const status = page.getByTestId('edit-status');
  const history = page.getByRole('region', { name: 'History' });
  const rows = history.getByRole('option');

  const toBar = async (bar: number) => {
    await page.locator('body').focus();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let step = 1; step < bar; step += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect(status).toContainText(`Bar ${String(bar)} ·`);
  };
  const rowCount = async (count: number) => {
    await expect(rows).toHaveCount(count);
    await expect(rows.last()).toHaveAttribute('aria-current', 'step');
  };

  // 1 and 2. A new song from the palette, and the riff typed in.
  await palette(app, 'New song');
  await app.waitReady();
  await app.gesture();
  await expect(status).toContainText('Bar 1 · End of bar · String 1');
  for (const step of r.steps) {
    if ('toggleInsert' in step) throw new Error('The riff does not use insert mode');
    await page.keyboard.press(step.press);
    if (step.pending !== undefined) await expect(status).toContainText(`Fret ${step.pending}…`);
  }
  expect(await app.description()).toBe('4 bars, 1 page');

  await palette(app, 'Show history');
  await expect(rows.first()).toHaveText('New song');
  await expect(rows).toHaveCount(1 + r.entries);
  const entered = 1 + r.entries;

  // 3. Effects by key on the cursor's note: palm mute, hammer-on, vibrato, a full bend.
  await toBar(1);
  await page.keyboard.press('p');
  await rowCount(entered + 1);
  // A hammer-on marks the note it goes to, so on beat 1 it lands on beat 2.
  await page.keyboard.press('h');
  await rowCount(entered + 2);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('v');
  await rowCount(entered + 3);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('b');
  const picker = page.getByRole('dialog', { name: 'Bend' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Full bend', exact: true }).click();
  await expect(picker).toBeHidden();
  await rowCount(entered + 4);

  // ...and on a range of two beats, which is one history row for both notes.
  await toBar(2);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press(';');
  await rowCount(entered + 5);

  // 4. Two bars after bar 4, then a repeat start on bar 5 and a repeat end, played three times, on 6.
  await toBar(4);
  await palette(app, 'Insert bar after');
  await palette(app, 'Insert bar after');
  expect(await app.description()).toBe('6 bars, 1 page');
  await toBar(5);
  await page.keyboard.press('[');
  await toBar(6);
  await palette(app, 'Bar properties');
  const dialog = page.getByRole('dialog', { name: 'Bar 6' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Repeat end').check();
  await dialog.getByLabel('Play count').fill('3');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  // 5. Bars 1 and 2 copied onto the empty bars 5 and 6.
  await toBar(1);
  await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(status).toContainText('Copied');
  await toBar(5);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(status).toContainText('Pasted');

  // 6. The first Save adds the song to the library. S1 is what every later state is held to.
  const s1 = await savedToLibrary(app, async () => {
    await page.locator('body').focus();
    await page.keyboard.press('ControlOrMeta+s');
  });
  const marked = chosenFields(s1);
  expect(s1.masterBars).toHaveLength(6);
  expect(marked.bars?.slice(0, 4).map((bar) => bar[0]?.map((b) => b.notes.length))).toEqual([
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ]);
  const first = marked.bars?.[0]?.[0]?.map((beat) => beat.notes[0]);
  expect(first?.[0]).toMatchObject({ palmMute: true });
  expect(first?.[1]).toMatchObject({ hammerPull: true, vibrato: 'slight' });
  expect(first?.[3]).toMatchObject({ bend: 'bend', bendHeight: 4 });
  const second = marked.bars?.[1]?.[0]?.map((beat) => beat.notes[0]);
  expect(second?.map((n) => n?.accent)).toEqual(['accent', 'accent', 'none', 'none']);
  expect(marked.bars?.[4]).toEqual(marked.bars?.[0]);
  expect(marked.bars?.[5]).toEqual(marked.bars?.[1]);
  expect(marked.repeats[4]).toMatchObject({ start: true });
  expect(marked.repeats[5]).toMatchObject({ endCount: 3 });
  // The riff itself, apart from the effects, is what was typed.
  const typed = r.bars.map((bar) =>
    (bar[0] ?? []).map((beat) => (beat.notes ?? []).map(([string, fret]) => ({ string, fret }))),
  );
  expect(
    marked.bars
      ?.slice(0, 4)
      .map((bar) =>
        (bar[0] ?? []).map((beat) => beat.notes.map(({ string, fret }) => ({ string, fret }))),
      ),
  ).toEqual(typed);

  const saveToLibrary = () =>
    savedToLibrary(app, async () => {
      await page.locator('body').focus();
      await page.keyboard.press('ControlOrMeta+s');
    });

  // 7. Back to the first row through the panel: the empty start score. Undo has nothing left.
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-current', 'step');
  await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(shapeOf(await saveToLibrary())).toEqual(shapeOf(expectedScore([{}])));

  // 8. Redo steps forward one row; the last row is S1 again.
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'step');
  await rows.last().click();
  await expect(rows.last()).toHaveAttribute('aria-current', 'step');
  // Native to native: the whole score, effects included, is held to S1.
  expect(shapeOf(await saveToLibrary())).toEqual(shapeOf(s1));

  // 9. Export as Guitar Pro. A dialog lists what a gp file cannot keep; none of it is ours.
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+Shift+e');
  const exportDialog = page.getByRole('dialog', { name: /^Export .+\.gp\?$/ });
  // This riff loses nothing in gp, so there is no loss dialog: the file is written straight away.
  await expect.poll(async () => (await app.saves()).length).toBe(1);
  await expect(exportDialog).toHaveCount(0);
  const [save] = await app.saves();
  const name = save?.suggestedName ?? '';
  expect(name).toMatch(/\.gp$/);
  await expect.poll(() => app.writeCount(name)).toBeGreaterThan(0);
  const exported = (await read(await app.readStored(name), 'gp')).score;
  expect(exported.tracks).toHaveLength(s1.tracks.length);
  expect(shapeOf(exported)).toEqual(shapeOf(s1));
  expect(chosenFields(exported).repeats).toEqual(marked.repeats);

  // 10. The export opened again: the same six bars, and the import (written to the library on
  // open) holds the same fields.
  const [known] = await app.listStored('library/songs');
  await app.pick(name);
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+o');
  await app.waitReady();
  expect(await app.description()).toBe('6 bars, 1 page');
  await expect.poll(() => app.listStored('library/songs')).toHaveLength(2);
  const imported = (await app.listStored('library/songs')).find((file) => file !== known) ?? '';
  expect(imported).not.toBe('');
  await expect.poll(() => app.songRows()).toBe(2);
  const reopened = (await read(await app.readStoredPath(`library/songs/${imported}`), 'reprise'))
    .score;
  expect(reopened.tracks).toHaveLength(s1.tracks.length);
  expect(shapeOf(reopened)).toEqual(shapeOf(s1));
  expect(chosenFields(reopened).repeats).toEqual(marked.repeats);
});
