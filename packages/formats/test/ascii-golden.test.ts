import { canShowTab } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { FormatError, read, writeAsciiTab } from '../src/index';
import { fixtureBytes } from './corpus';

// The goldens in test/ascii/ are reviewed by eye; regenerate with `vitest -u` and read the diff.
const GOLDENS: readonly { path: string; drops: readonly string[] }[] = [
  {
    path: 'gp5/effects.gp5',
    drops: ['grace-notes', 'harmonic-kind', 'whammy', 'tremolo-picking', 'stroke'],
  },
  { path: 'gp/track-volume.gp', drops: [] },
  { path: 'gp5/directions.gp5', drops: [] },
  { path: 'gp/beat-tempo-change.gp', drops: [] },
  { path: 'gp5/chords.gp5', drops: [] },
  { path: 'gp/multivoice-rhythm.gp', drops: ['other-voices'] },
  { path: 'gp5/repeat-close-alternate-endings.gp5', drops: [] },
  { path: 'gp4/time-signatures.gp4', drops: [] },
  { path: 'gp/beat-lyrics.gp', drops: [] },
  { path: 'gp5/bass-tuning.gp5', drops: [] },
];

describe('ASCII tab goldens', () => {
  it.each(GOLDENS)('$path', async ({ path, drops }) => {
    const { score } = await read(fixtureBytes(path));
    const tracks = score.tracks.filter(canShowTab).map((track) => track.id);
    const { text, dropped } = writeAsciiTab(score, { tracks });
    await expect(text).toMatchFileSnapshot(`ascii/${path.replace('/', '-')}.txt`);
    expect(dropped.map((warning) => warning.code)).toEqual(drops);
  });

  it('refuses a drum track on its own', async () => {
    const { score } = await read(fixtureBytes('gp/drum-tabs.gp'));
    const tracks = score.tracks.map((track) => track.id);
    expect(() => writeAsciiTab(score, { tracks })).toThrow(FormatError);
    try {
      writeAsciiTab(score, { tracks });
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-track' });
    }
  });
});
