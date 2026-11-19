import { readFileSync } from 'node:fs';

import { read } from '@reprise/formats';

import { expect, test } from '../player/test/app';
import { fixture } from '../player/test/scores';
import { quarters, saveKey, toBar, typeSong, openHistory } from './test/editor';

// WP-085's inline field: a chord name, beat text and a lyric line typed over the beat they belong
// to, one History row per word, and what the file holds afterwards.
test('A chord name, beat text and a lyric line are typed in the inline field, one undo step per word', async ({
  app,
  page,
}) => {
  const r = quarters([6, [0, 3, 5, 3]], [5, [0, 2, 3, 2]]);
  await typeSong(app, r);
  const { rows, typed, rowCount } = await openHistory(app, r);
  const field = (name: RegExp) =>
    page.getByRole('textbox', { name }).or(page.getByRole('combobox', { name }));
  const inScore = (text: string) => page.locator('svg text', { hasText: new RegExp(`^${text}$`) });
  await rowCount(typed);

  // A names the chord on the beat; Tab commits it and moves to the next beat; Enter commits and closes.
  await toBar(app, 1);
  await page.keyboard.press('a');
  await expect(field(/^Chord name, bar 1 beat 1$/)).toBeFocused();
  await page.keyboard.type('Am');
  await page.keyboard.press('Tab');
  await expect(field(/^Chord name, bar 1 beat 2$/)).toBeFocused();
  await page.keyboard.type('C');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-status')).not.toContainText('Chord name');
  await expect(inScore('Am')).toHaveCount(1);
  await expect(inScore('C')).toHaveCount(1);
  await rowCount(typed + 2);
  await expect(rows.nth(typed)).toHaveText('Chord name');
  await expect(rows.nth(typed + 1)).toHaveText('Chord name');

  // T puts text on the beat, in bar 2.
  await toBar(app, 2);
  await page.keyboard.press('t');
  await expect(field(/^Text, bar 2 beat 1$/)).toBeFocused();
  await page.keyboard.type('riff');
  await page.keyboard.press('Enter');
  await expect(inScore('riff')).toHaveCount(1);
  await rowCount(typed + 3);
  await expect(rows.last()).toHaveText('Text');

  // Alt+L is the lyric line: Space moves on, a hyphen ends a syllable that goes on in the next word.
  await toBar(app, 1);
  await page.keyboard.press('Alt+l');
  await expect(field(/^Lyrics line 1, bar 1 beat 1$/)).toBeFocused();
  await page.keyboard.type('Hel-');
  await page.keyboard.type('lo');
  await page.keyboard.press('Space');
  await page.keyboard.type('world');
  await page.keyboard.press('Space');
  await page.keyboard.type('again');
  await page.keyboard.press('Enter');
  await rowCount(typed + 7);
  for (let word = 3; word < 7; word += 1) await expect(rows.nth(typed + word)).toHaveText('Lyrics');
  await expect(inScore('Hel')).toHaveCount(1);
  await expect(inScore('-')).toHaveCount(1);
  await expect(inScore('lo')).toHaveCount(1);
  await expect(inScore('world')).toHaveCount(1);
  await expect(inScore('again')).toHaveCount(1);

  // One undo takes back the last word only.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(typed + 7);
  await expect(rows.nth(typed + 5)).toHaveAttribute('aria-current', 'step');
  await expect(inScore('again')).toHaveCount(0);
  await expect(inScore('world')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await rowCount(typed + 7);

  // What the file holds.
  const saved = await saveKey(app);
  const [bar1, bar2] = saved.tracks[0]?.bars ?? [];
  const beats1 = bar1?.voices[0]?.beats ?? [];
  expect(beats1.map((beat) => beat.chord?.name)).toEqual(['Am', 'C', undefined, undefined]);
  expect(beats1.map((beat) => beat.lyrics?.[0])).toEqual(['Hel-', 'lo', 'world', 'again']);
  expect(bar2?.voices[0]?.beats[0]?.text).toBe('riff');
});

test('Editing a lyric of a song that has its words on the beats replaces the word, and the file keeps it', async ({
  app,
  page,
}) => {
  // The precondition of the last check: the fixture carries a raw lyrics block to be cleared.
  const original = await read(readFileSync(fixture('gp/beat-lyrics.gp')), 'gp');
  expect(original.score.tracks[0]?.lyrics.length).toBeGreaterThan(0);
  await app.openWithPicker(fixture('gp/beat-lyrics.gp'));
  await page.keyboard.press('ControlOrMeta+e');
  const status = page.getByTestId('edit-status');
  await expect(status).toContainText('Bar 1 ·');
  await page.keyboard.press('Alt+l');
  const word = page.getByRole('textbox', { name: /^Lyrics line 1, bar 1 beat 1$/ });
  await expect(word).toHaveValue('This');
  await page.keyboard.type('That');
  await page.keyboard.press('Enter');
  await expect(page.locator('svg text', { hasText: /^That$/ })).toHaveCount(1);
  await expect(page.locator('svg text', { hasText: /^This$/ })).toHaveCount(0);

  const saved = await saveKey(app);
  const beats = saved.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
  expect(beats.map((beat) => beat.lyrics?.[0])).toEqual(['That', 'is', 'a', 'test file']);
  // The raw lyrics block (one sentence for the whole track) would be laid out again by readers
  // once the beat lyrics are gone: an edit of the beat lyrics clears it.
  expect(saved.tracks[0]?.lyrics).toEqual([]);
});
