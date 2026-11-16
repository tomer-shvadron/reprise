import { expect, test } from '../player/test/app';
import { palette, quarters, saveKey, toBar, typeSong } from './test/editor';

// WP-082's panel and pickers, driven as a user does: the buttons' state comes from the notes
// under the cursor, a press is one History row, and what ends up in the file is what was pressed.
test('The Effects panel toggles, reads mixed, opens the bend picker and goes quiet outside edit mode', async ({
  app,
  page,
}) => {
  const r = quarters([6, [0, 3, 5, 3]], [5, [0, 2, 3, 2]]);
  await typeSong(app, r);
  await palette(app, 'Toggle effects panel');

  const panel = page.getByRole('region', { name: 'Effects', exact: true });
  const button = (name: string) => panel.getByRole('button', { name, exact: true });
  const palmMute = button('Palm mute');
  // `P.M.` is the painter's label for a palm-muted run, text in the score's SVG.
  const labels = page.locator('svg text', { hasText: 'P.M.' });
  const typed = 1 + r.entries;

  // A press sets the effect on the note under the cursor, and the label is drawn.
  await toBar(app, 1);
  await expect(palmMute).toHaveAttribute('aria-pressed', 'false');
  await expect(labels).toHaveCount(0);
  await palmMute.click();
  await expect(palmMute).toHaveAttribute('aria-pressed', 'true');
  await expect(labels).not.toHaveCount(0);
  // ...and a second press takes it off again.
  await palmMute.click();
  await expect(palmMute).toHaveAttribute('aria-pressed', 'false');
  await expect(labels).toHaveCount(0);

  // A range of two notes with one of them muted reads mixed; a press sets it on both, as one row.
  await palmMute.click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(palmMute).toHaveAttribute('aria-pressed', 'mixed');
  await palmMute.click();
  await expect(palmMute).toHaveAttribute('aria-pressed', 'true');

  // The bend picker: a full bend on the first note of bar 2, and Remove takes it off.
  await toBar(app, 2);
  await button('Bend…').click();
  const picker = page.getByRole('dialog', { name: 'Bend' });
  await picker.getByRole('button', { name: 'Full bend', exact: true }).click();
  await expect(picker).toBeHidden();
  const bent = await saveKey(app);
  expect(bent.tracks[0]?.bars[1]?.voices[0]?.beats[0]?.notes[0]?.bend).toMatchObject({
    kind: 'bend',
  });
  await button('Bend…').click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(picker).toBeHidden();

  // What the file holds is what was pressed: the first two notes muted, nothing bent.
  const saved = await saveKey(app);
  const [bar1, bar2] = saved.tracks[0]?.bars ?? [];
  expect(bar1?.voices[0]?.beats.map((beat) => beat.notes[0]?.palmMute)).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(bar2?.voices[0]?.beats[0]?.notes[0]?.bend).toBeUndefined();

  // The History panel shares the right panel with this one: every press above is one row.
  await palette(app, 'Show history');
  const rows = page.getByRole('region', { name: 'History' }).getByRole('option');
  await expect(rows).toHaveCount(typed + 6);
  expect((await rows.allTextContents()).slice(typed)).toEqual([
    'Palm mute',
    'Remove palm mute',
    'Palm mute',
    'Palm mute',
    'Full bend',
    'Remove bend',
  ]);
  await palette(app, 'Toggle effects panel');

  // Outside edit mode the panel keeps its buttons but disables them.
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByTestId('edit-status')).toBeHidden();
  await expect(palmMute).toBeDisabled();
  await expect(button('Bend…')).toBeDisabled();
});
