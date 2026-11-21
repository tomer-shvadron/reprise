import { write } from '@reprise/formats';
import { setBeatEffect } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commitEdit } from '@/features/editor';
import { stubViewport } from '@/features/score/test/viewport-stub';
import { CHORD_STRIP_SETTING } from '@/state/app-settings';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { ScorePane } from './score-pane';

/** A long song with Am in the first bar and again in the last, so a step has far to scroll. */
function longSong() {
  const b = score().track('guitar');
  for (let bar = 0; bar < 40; bar += 1) {
    const chord = bar === 0 || bar === 39 ? { chord: { name: 'Am' } } : {};
    b.bar()
      .beat('4', [note(1, 0)], chord)
      .rest('2')
      .rest('4');
  }
  return b.build({ ids: 'sequential' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  stubViewport(900, 300);
  const scrolled = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: scrolled,
  });
  const services = createTestServices();
  renderWithServices(<ScorePane hint={<p>Open a file</p>} />, services);
  const bytes = (await write(longSong(), 'reprise')).bytes;
  await act(() => services.document.getState().openBytes('long.reprise', bytes));
  act(() => {
    services.settings.set(CHORD_STRIP_SETTING, true);
  });
  return { services, scrolled };
}

describe('stepping through a chord in the strip', () => {
  it('scrolls the score to the next place and leaves playback where it was', async () => {
    const { services, scrolled } = await setup();
    const user = userEvent.setup();
    const before = services.playback.getState();
    await user.click(screen.getByRole('button', { name: /^Am,/ }));
    scrolled.mockClear();
    await user.keyboard('{ArrowRight}');
    expect(scrolled).toHaveBeenCalled();
    expect(services.playback.getState()).toBe(before);
  });

  it('does not scroll for an edit with a pick set', async () => {
    const { services, scrolled } = await setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Am,/ }));
    scrolled.mockClear();
    const bar = services.document.getState().score?.tracks[0]?.bars[5];
    const beat = bar?.voices[0]?.beats[0];
    if (!beat) throw new Error('no beat');
    act(() => {
      commitEdit(services, setBeatEffect({ beatId: beat.id }, { chord: { name: 'G' } }), {
        moveCursor: false,
      });
    });
    expect(
      services.document.getState().score?.tracks[0]?.bars[5]?.voices[0]?.beats[0]?.chord,
    ).toEqual({ name: 'G' });
    expect(scrolled).not.toHaveBeenCalled();
  });
});
