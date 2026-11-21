import { write } from '@reprise/formats';
import { parseNative, type Score } from '@reprise/model';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { ScorePane } from '@/app/score-pane';
import { layoutForPrint, PrintDocument } from '@/features/score';
import { CHORD_STRIP_SETTING } from '@/state/app-settings';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { expectScoreFonts } from './test/paint-page';

import '@/index.css';

const FIXTURE = 'gpx/chords.gpx';

function chordsScore(): Score {
  const found = inject('scoreFixtures').find(({ path }) => path === FIXTURE);
  if (!found) throw new Error(`the corpus has no fixture ${FIXTURE}`);
  return parseNative(new TextEncoder().encode(found.native)).score;
}

beforeAll(expectScoreFonts);
afterEach(cleanup);

describe('the chord strip (#352)', () => {
  it('prints under the title, over the first system', async () => {
    document.body.style.margin = '0';
    document.documentElement.dataset['theme'] = 'dark';
    const built = chordsScore();
    const content = layoutForPrint(
      built,
      { tracks: built.tracks.map(({ id }) => id), paper: 'a4', header: true, pageNumbers: true },
      {},
      'chords.gpx',
      { chordStrip: true },
    );
    const { container } = render(
      <div className="bg-background">
        <PrintDocument preview content={content} />
      </div>,
    );
    const page = container.querySelector<HTMLElement>('[data-page="0"]');
    if (!page) throw new Error('no first page');
    await expect.element(page).toMatchScreenshot('chord-strip-print-a4-p0-dark');
  });

  it.each(['dark', 'light'] as const)(
    'docks above the score with a chord picked and its places boxed, in %s',
    async (theme) => {
      document.body.style.margin = '0';
      document.documentElement.dataset['theme'] = theme;
      const services = createTestServices();
      const { container } = renderWithServices(
        <div className="bg-background text-foreground" style={{ width: 1100, height: 520 }}>
          <ScorePane hint={<p>Open a file</p>} />
        </div>,
        services,
      );
      const bytes = (await write(chordsScore(), 'reprise')).bytes;
      await act(() => services.document.getState().openBytes('chords.reprise', bytes));
      act(() => {
        services.settings.set(CHORD_STRIP_SETTING, true);
      });
      const track = services.document.getState().score?.tracks[0];
      const key = container.querySelectorAll('section[aria-label="Chord strip"] li button')[1];
      if (!track || !key) throw new Error('no strip');
      act(() => {
        (key as HTMLElement).click();
      });
      const frame = container.firstElementChild;
      if (!(frame instanceof HTMLElement)) throw new Error('no frame');
      await expect.element(frame).toMatchScreenshot(`chord-strip-docked-${theme}`);
    },
  );
});
