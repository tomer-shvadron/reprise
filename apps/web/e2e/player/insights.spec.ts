import { expect, test } from './test/app';
import { generated, INSIGHTS } from './test/scores';

test('the Song tab shows the key, sections, chords and tracks, and marks a scale on the fretboard', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated(INSIGHTS.file));
  await page
    .getByRole('group', { name: 'Panel rail' })
    .getByRole('button', { name: 'Song' })
    .click();
  await page.getByRole('tab', { name: 'Insights' }).click();

  const panel = page.getByRole('region', { name: 'Song insights' });
  // The analysis runs in a worker: the cards appear when it answers.
  await expect(panel.locator('[data-insight-card="key"]')).toBeVisible();
  await expect(panel.locator('[data-insight-card="scale"]')).toBeVisible();

  const sections = panel.getByRole('region', { name: 'Sections' });
  await expect(sections.locator('[data-insight-section]')).toHaveCount(INSIGHTS.sections.length);
  await expect(sections.getByRole('button', { name: 'Verse', exact: true })).toBeVisible();

  const chords = panel.getByRole('region', { name: 'Chords' });
  for (const name of ['Am', 'F', 'C', 'G']) {
    await expect(
      chords.getByRole('button', { name: new RegExp(`^${name}, \\d+ times`) }),
    ).toBeVisible();
  }
  await expect(
    chords.getByRole('list', { name: 'Progressions' }).getByText(INSIGHTS.progression).first(),
  ).toBeVisible();
  await expect(chords.getByText('Inferred from the notes.')).toHaveCount(0);

  const tracks = panel.getByRole('region', { name: 'Tracks' });
  await expect(tracks.locator('[data-insight-track="Rhythm"]')).toBeVisible();
  await expect(tracks.locator('[data-insight-track="Lead"]')).toBeVisible();
  await expect(tracks.getByText(/^Difficulty \d of 5 \(rough\)$/).first()).toBeVisible();

  // Show on fretboard on a section's scale opens the dock with the scale marked.
  await sections
    .locator('[data-insight-section="Verse"]')
    .getByRole('button', { name: /^Show .* on fretboard$/ })
    .first()
    .click();
  const board = page.getByRole('tabpanel', { name: 'Fretboard' });
  await expect(board.locator('[data-fretboard-scale] [data-scale-tone]').first()).toBeVisible();

  // A chord chip opens the Chords sub-tab on that chord.
  await chords.getByRole('button', { name: /^Am, \d+ times/ }).click();
  await expect(page.getByRole('tab', { name: 'Chords' })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('region', { name: 'Chord shapes' }).getByLabel('Chord', { exact: true }),
  ).toHaveValue('Am');
});
