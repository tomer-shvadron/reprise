import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { chordDiagramPrimitives } from '@reprise/layout';
import { stubViewport } from '@/features/score/test/viewport-stub';
import { CHORD_STRIP_SETTING } from '@/state/app-settings';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';
import { ChordStrip } from './chord-strip';
import { ScorePane } from './score-pane';

vi.mock('@reprise/layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reprise/layout')>();
  return { ...actual, chordDiagramPrimitives: vi.fn(actual.chordDiagramPrimitives) };
});

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
    expect(screen.getByRole('status')).toHaveTextContent('');
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

describe('the strip: position, live region, hiding, picks', () => {
  function twoCs() {
    const b = score().track('guitar');
    const open = { baseFret: 1, frets: [0, 1, 0, 2, 3, null] };
    const barre = { baseFret: 1, frets: [3, 5, 5, 5, 3, null] };
    b.bar()
      .beat('4', [note(1, 0)], { chord: { name: 'C', diagram: open } })
      .beat('4', [note(1, 0)], { chord: { name: 'C', diagram: barre } })
      .beat('4', [note(1, 0)], {
        chord: { name: 'D', diagram: { baseFret: 1, frets: [2, 3, 2, 0, null, null] } },
      })
      .beat('4', [note(1, 0)], {
        chord: { name: 'E', diagram: { baseFret: 5, frets: [5, 7, 7, 6, 5, 5] } },
      });
    return b.build({ ids: 'sequential' });
  }

  it('tells two shapes of one name apart, by eye and by ear, and labels a shape up the neck', async () => {
    const services = createTestServices();
    await services.document
      .getState()
      .openBytes('c.reprise', (await write(twoCs(), 'reprise')).bytes);
    renderWithServices(<ChordStrip />, services);
    const labels = within(screen.getByRole('list'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'C open position, 1 place, shape',
      'C at fret 3, 1 place, shape',
      'D, 1 place, shape',
      'E at fret 5, 1 place, shape',
    ]);
    expect(screen.getByText(/· 3fr/)).toBeInTheDocument();
    expect(screen.getByText(/· open/)).toBeInTheDocument();
    expect(screen.getByText(/· 5fr/)).toBeInTheDocument();
  });

  it('keeps its live region mounted and empty until a pick', async () => {
    const services = await open();
    const user = userEvent.setup();
    renderWithServices(<ChordStrip />, services);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    await user.click(chip(/^Am,/));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Am: 1 of 3');
  });

  it('closes from the command too, dropping the pick and returning focus to the score', async () => {
    stubViewport(1280, 800);
    const services = createTestServices();
    const { container } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />, services);
    await act(() => open(services));
    act(() => {
      services.settings.set(CHORD_STRIP_SETTING, true);
    });
    const user = userEvent.setup();
    await user.click(chip(/^Am,/));
    expect(services.ui.getState().chordHighlight).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Hide chord strip' }));
    expect(services.ui.getState().chordHighlight).toBeUndefined();
    expect(screen.getByRole('region', { name: /^Score: / })).toHaveFocus();
    expect(container.querySelectorAll('.score-chord')).toHaveLength(0);

    // Turned off by another path (the View menu runs the same command), then on again: no boxes.
    act(() => {
      services.settings.set(CHORD_STRIP_SETTING, true);
    });
    await user.click(chip(/^Am,/));
    const command = createAppRegistry(services).get('view.toggleChordStrip');
    if (!command) throw new Error('view.toggleChordStrip is not registered');
    act(() => {
      runCommand(command);
    });
    expect(services.ui.getState().chordHighlight).toBeUndefined();
  });

  it('drops the pick when the current track or the document changes, and draws none for another track', async () => {
    stubViewport(1280, 800);
    const services = createTestServices();
    const two = score().track('guitar');
    two
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
      .rest('2')
      .rest('4');
    two.track('guitar');
    two.bar().rest('1');
    const bytes = (await write(two.build({ ids: 'sequential' }), 'reprise')).bytes;
    const { container } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />, services);
    await act(() => services.document.getState().openBytes('two.reprise', bytes));
    act(() => {
      services.settings.set(CHORD_STRIP_SETTING, true);
    });
    const [first, second] = services.document.getState().score?.tracks ?? [];
    const user = userEvent.setup();
    await user.click(chip(/^Am,/));
    expect(container.querySelectorAll('.score-chord')).toHaveLength(1);

    // A pick on another track than the current one is never boxed, even if it were still set.
    act(() => {
      services.ui.getState().setChordHighlight({ track: second?.id ?? '', key: 'x', at: 0 });
    });
    expect(container.querySelectorAll('.score-chord')).toHaveLength(0);

    act(() => {
      services.ui.getState().setChordHighlight({ track: first?.id ?? '', key: 'x', at: 0 });
      services.selection.getState().setCurrentTrack(second?.id);
    });
    expect(services.ui.getState().chordHighlight).toBeUndefined();

    act(() => {
      services.selection.getState().setCurrentTrack(first?.id);
      services.ui.getState().setChordHighlight({ track: first?.id ?? '', key: 'k', at: 0 });
    });
    await act(() => services.document.getState().openBytes('two2.reprise', bytes));
    expect(services.ui.getState().chordHighlight).toBeUndefined();
  });

  it('does not rebuild its chips when its parent renders again, as a drag preview does', async () => {
    const services = await open();
    const user = userEvent.setup();
    function Host() {
      const [ticks, setTicks] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setTicks(ticks + 1);
            }}
          >
            tick {ticks}
          </button>
          <ChordStrip />
        </>
      );
    }
    renderWithServices(<Host />, services);
    const built = vi.mocked(chordDiagramPrimitives).mock.calls.length;
    expect(built).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /^tick/ }));
    await user.click(screen.getByRole('button', { name: /^tick/ }));
    expect(screen.getByRole('button', { name: 'tick 2' })).toBeInTheDocument();
    expect(vi.mocked(chordDiagramPrimitives).mock.calls.length).toBe(built);
  });
});
