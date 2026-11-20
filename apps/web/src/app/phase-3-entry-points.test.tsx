import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { App } from './app';
import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';

function renderApp() {
  const services = createTestServices();
  render(<App services={services} keyboard="mac" />);
  const run = (id: string) => {
    const command = createAppRegistry(services).get(id);
    if (!command) throw new Error(`no command ${id}`);
    act(() => {
      runCommand(command);
    });
  };
  return { services, run };
}

describe('phase 3 entry points', () => {
  it('opens the library sheet and closes it again', async () => {
    const { run } = renderApp();
    run('library.show');
    const dialog = screen.getByRole('dialog', { name: 'Library' });
    expect(within(dialog).getByRole('searchbox', { name: 'Search songs' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('opens the library from the header crumb and closes it again', async () => {
    renderApp();
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Library' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Library' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('opens the sound manager as a sheet with exactly one Sounds heading', () => {
    const { run } = renderApp();
    run('sounds.show');
    const dialog = screen.getByRole('dialog', { name: 'Sounds' });
    expect(within(dialog).getAllByRole('heading', { name: 'Sounds' })).toHaveLength(1);
  });

  it('trainer.speedTrainer opens the right panel on the speed trainer', () => {
    const { run } = renderApp();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run('trainer.speedTrainer');
    expect(
      within(screen.getByRole('complementary', { name: 'Panel' })).getByRole('region', {
        name: 'Speed trainer',
      }),
    ).toBeInTheDocument();
  });

  it('editor.toggleEffectsPanel shows the effects panel in the right panel and hides it again', () => {
    const { services, run } = renderApp();
    run('editor.toggleEffectsPanel');
    const panel = screen.getByRole('complementary', { name: 'Panel' });
    expect(within(panel).getByRole('region', { name: 'Effects' })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('Placeholder');
    run('editor.toggleEffectsPanel');
    expect(services.ui.getState().panels.rightPanel).toBe(false);
  });

  it('editor.showHistory shows the history panel in the right panel and hides it again', () => {
    const { services, run } = renderApp();
    run('editor.showHistory');
    const panel = screen.getByRole('complementary', { name: 'Panel' });
    expect(within(panel).getByRole('region', { name: 'History' })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('WP-084');
    run('editor.showHistory');
    expect(services.ui.getState().panels.rightPanel).toBe(false);
  });

  it('trainer.tuner opens the right panel on the Tuner region', () => {
    const { run } = renderApp();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run('trainer.tuner');
    expect(
      within(screen.getByRole('complementary', { name: 'Panel' })).getByRole('region', {
        name: 'Tuner',
      }),
    ).toBeInTheDocument();
  });

  it('trainer.fretboard opens the bottom region on the fretboard and toggles it closed', () => {
    const { run } = renderApp();
    expect(screen.queryByRole('tabpanel', { name: 'Fretboard' })).not.toBeInTheDocument();
    run('trainer.fretboard');
    expect(screen.getByRole('tabpanel', { name: 'Fretboard' })).toHaveTextContent(
      'No fretted track selected',
    );
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run('trainer.fretboard');
    expect(screen.queryByRole('tabpanel', { name: 'Fretboard' })).not.toBeInTheDocument();
  });

  it('trainer.metronome opens the metronome with no song open', () => {
    const { run } = renderApp();
    run('trainer.metronome');
    expect(
      within(screen.getByRole('complementary', { name: 'Panel' })).getByRole('region', {
        name: 'Metronome',
      }),
    ).toBeInTheDocument();
  });

  it('switches the right panel back to the mixer', () => {
    const { services, run } = renderApp();
    run('trainer.speedTrainer');
    const panel = screen.getByRole('complementary', { name: 'Panel' });
    expect(within(panel).getByRole('region', { name: 'Speed trainer' })).toBeInTheDocument();
    act(() => {
      services.ui.getState().showPanelView('mixer');
    });
    expect(
      within(screen.getByRole('complementary', { name: 'Panel' })).queryByRole('region', {
        name: 'Speed trainer',
      }),
    ).not.toBeInTheDocument();
  });

  it('lists the commands in the palette registry', () => {
    const { services } = renderApp();
    const ids = createAppRegistry(services)
      .list()
      .map((command) => command.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'library.show',
        'sounds.show',
        'trainer.speedTrainer',
        'trainer.tuner',
        'trainer.tunerToggle',
        'trainer.metronome',
        'trainer.fretboard',
        'editor.toggleMode',
        'editor.toggleEffectsPanel',
        'editor.showHistory',
      ]),
    );
  });

  it('does not toggle edit mode with no document open', () => {
    const { services, run } = renderApp();
    run('editor.toggleMode');
    expect(services.editing.getState().editing).toBe(false);
  });

  it('toggles edit mode with a score open and resets it on a new document and on close', async () => {
    const { services, run } = renderApp();
    const { bytes } = await write(score().title('Riff').build(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('riff.reprise', bytes);
    });
    run('editor.toggleMode');
    expect(services.editing.getState().editing).toBe(true);
    await act(async () => {
      await services.document.getState().openBytes('second.reprise', bytes);
    });
    expect(services.editing.getState().editing).toBe(false);
    run('editor.toggleMode');
    act(() => {
      services.document.getState().close();
    });
    expect(services.editing.getState().editing).toBe(false);
  });

  describe('the mixer toggle', () => {
    it('F8 shows the mixer when the panel holds a trainer view, then closes it', async () => {
      const { services, run } = renderApp();
      const user = userEvent.setup();
      run('trainer.speedTrainer');
      await user.keyboard('{F8}');
      expect(services.ui.getState().rightPanelView).toBe('mixer');
      expect(
        within(screen.getByRole('complementary', { name: 'Panel' })).queryByRole('region', {
          name: 'Speed trainer',
        }),
      ).not.toBeInTheDocument();
      await user.keyboard('{F8}');
      expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    });

    it('the rail Mixer button does the same, and opens the mixer from closed', async () => {
      const { services, run } = renderApp();
      const user = userEvent.setup();
      run('trainer.metronome');
      const button = screen.getByRole('button', { name: 'Mixer' });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      await user.click(button);
      expect(services.ui.getState().rightPanelView).toBe('mixer');
      expect(button).toHaveAttribute('aria-pressed', 'true');
      await user.click(button);
      expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
      await user.click(button);
      expect(screen.getByRole('complementary', { name: 'Panel' })).toBeInTheDocument();
    });
  });

  describe('a sheet', () => {
    it('takes focus in the search box, hides the player, and gives focus back on Escape', async () => {
      const { run } = renderApp();
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', { name: 'Toggle tracks' });
      toggle.focus();
      run('library.show');
      const dialog = screen.getByRole('dialog', { name: 'Library' });
      expect(within(dialog).getByRole('searchbox', { name: 'Search songs' })).toHaveFocus();
      expect(screen.queryByRole('main', { name: 'Score' })).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument();
      expect(toggle).toHaveFocus();
      expect(screen.getByRole('main', { name: 'Score' })).toBeInTheDocument();
    });

    it('puts focus on the Sounds heading, not on a button', () => {
      const { run } = renderApp();
      run('sounds.show');
      const dialog = screen.getByRole('dialog', { name: 'Sounds' });
      expect(within(dialog).getByRole('heading', { name: 'Sounds' })).toHaveFocus();
    });

    it('still plays and pauses with Space, which no other shortcut does', async () => {
      const { services, run } = renderApp();
      const user = userEvent.setup();
      const { bytes } = await write(score().title('Riff').build(), 'reprise');
      await act(async () => {
        await services.document.getState().openBytes('riff.reprise', bytes);
      });
      run('sounds.show');
      const dialog = screen.getByRole('dialog', { name: 'Sounds' });
      const before = services.fakeAudio.togglePlay.mock.calls.length;
      within(dialog).getByRole('heading', { name: 'Sounds' }).focus();
      await user.keyboard(' ');
      expect(services.fakeAudio.togglePlay.mock.calls.length).toBe(before + 1);
      await user.keyboard('{Meta>}k{/Meta}');
      expect(services.ui.getState().paletteOpen).toBe(false);
    });
  });
});
