import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { CHORD_STRIP_SETTING } from '@/state/app-settings';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { ChordStrip } from './chord-strip';
import { ScorePane } from './score-pane';

const own = { baseFret: 1, frets: [0, 1, 2, 2, 0, null] };

function song() {
  const b = score().track('guitar');
  b.bar()
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)], { chord: { name: 'G', diagram: own } })
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)], { chord: { name: 'Zzz' } });
  b.bar()
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)])
    .rest('2');
  return b.build({ ids: 'sequential' });
}

async function open(services = createTestServices()) {
  await services.document
    .getState()
    .openBytes('chords.reprise', (await write(song(), 'reprise')).bytes);
  return services;
}

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('the chord strip', () => {
  it('lists the current track chords in first-use order, marking where each shape came from', async () => {
    const services = await open();
    renderWithServices(<ChordStrip />, services);
    const labels = within(screen.getByRole('list'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Am, 3 places, suggested shape',
      'G, 1 place, shape',
      'Zzz, 1 place, no shape',
    ]);
  });

  it('boxes every place on a click, steps through them with the arrows without seeking, and Esc clears', async () => {
    const services = await open();
    const user = userEvent.setup();
    renderWithServices(<ChordStrip />, services);
    const before = services.playback.getState();
    await user.click(chip(/^Am,/));
    expect(chip(/^Am,/)).toHaveAttribute('aria-pressed', 'true');
    expect(services.ui.getState().chordHighlight).toMatchObject({ at: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Am: 1 of 3');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('Am: 2 of 3');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('Am: 1 of 3');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('Am: 3 of 3');
    expect(services.playback.getState()).toBe(before);

    await user.keyboard('{Escape}');
    expect(services.ui.getState().chordHighlight).toBeUndefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears the pick on a second click and steps with its own buttons', async () => {
    const services = await open();
    const user = userEvent.setup();
    renderWithServices(<ChordStrip />, services);
    await user.click(chip(/^Am,/));
    await user.click(screen.getByRole('button', { name: 'Next place' }));
    expect(screen.getByRole('status')).toHaveTextContent('Am: 2 of 3');
    await user.click(screen.getByRole('button', { name: 'Previous place' }));
    expect(screen.getByRole('status')).toHaveTextContent('Am: 1 of 3');
    await user.click(chip(/^Am,/));
    expect(services.ui.getState().chordHighlight).toBeUndefined();
  });

  it('folds to its title bar and keeps the pick', async () => {
    const services = await open();
    const user = userEvent.setup();
    renderWithServices(<ChordStrip />, services);
    await user.click(screen.getByRole('button', { name: 'Fold chords' }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(services.ui.getState().chordStripFolded).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show chords' }));
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('turns the setting off from its close button', async () => {
    const services = await open();
    services.settings.set(CHORD_STRIP_SETTING, true);
    const user = userEvent.setup();
    renderWithServices(<ChordStrip />, services);
    await user.click(screen.getByRole('button', { name: 'Hide chord strip' }));
    expect(services.settings.get(CHORD_STRIP_SETTING)).toBe(false);
  });

  it('says so for a track with no chords', async () => {
    const services = createTestServices();
    const b = score().track('guitar');
    b.bar()
      .beat('4', [note(1, 0)])
      .rest('2')
      .rest('4');
    await services.document
      .getState()
      .openBytes('plain.reprise', (await write(b.build({ ids: 'sequential' }), 'reprise')).bytes);
    renderWithServices(<ChordStrip />, services);
    expect(screen.getByText('This track has no chords.')).toBeInTheDocument();
  });
});

describe('the strip in the score pane', () => {
  it('is off until the setting is on, and boxes the picked chord where the score draws it', async () => {
    stubViewport(1280, 800);
    const services = createTestServices();
    const { container } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />, services);
    await act(() => open(services));
    expect(screen.queryByRole('region', { name: 'Chord strip' })).toBeNull();

    act(() => {
      services.settings.set(CHORD_STRIP_SETTING, true);
    });
    expect(screen.getByRole('region', { name: 'Chord strip' })).toBeInTheDocument();
    expect(container.querySelectorAll('.score-chord')).toHaveLength(0);

    const user = userEvent.setup();
    await user.click(chip(/^Am,/));
    // Three places, and the one the arrows are on is boxed again, stronger.
    expect(container.querySelectorAll('.score-chord')).toHaveLength(3);
    expect(container.querySelectorAll('.score-chord-now')).toHaveLength(1);
    await user.keyboard('{ArrowRight}');
    expect(container.querySelectorAll('.score-chord-now')).toHaveLength(1);

    act(() => {
      services.settings.set(CHORD_STRIP_SETTING, false);
    });
    expect(container.querySelectorAll('.score-chord')).toHaveLength(0);
  });
});
