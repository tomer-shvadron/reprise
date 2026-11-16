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
  it('opens the library screen and returns to the player', async () => {
    const { run } = renderApp();
    run('library.show');
    const region = screen.getByRole('region', { name: 'Library' });
    expect(within(region).getByRole('searchbox', { name: 'Search songs' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to player' }));
    expect(screen.queryByRole('region', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('opens the sound manager', () => {
    const { run } = renderApp();
    run('sounds.show');
    expect(
      within(screen.getByRole('region', { name: 'Sounds' })).getByRole('heading', {
        name: 'Sounds',
      }),
    ).toBeInTheDocument();
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

  it('trainer.tuner opens the right panel on its placeholder', () => {
    const { run } = renderApp();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run('trainer.tuner');
    expect(screen.getByRole('complementary', { name: 'Panel' })).toHaveTextContent('WP-071');
  });

  it('trainer.fretboard opens the bottom region on the fretboard and toggles it closed', () => {
    const { run } = renderApp();
    expect(screen.queryByRole('region', { name: 'Fretboard' })).not.toBeInTheDocument();
    run('trainer.fretboard');
    expect(screen.getByRole('region', { name: 'Fretboard' })).toHaveTextContent(
      'No fretted track selected',
    );
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run('trainer.fretboard');
    expect(screen.queryByRole('region', { name: 'Fretboard' })).not.toBeInTheDocument();
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
        'trainer.metronome',
        'trainer.fretboard',
        'editor.toggleMode',
        'editor.toggleEffectsPanel',
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

    it('the footer button does the same, and opens the mixer from closed', async () => {
      const { services, run } = renderApp();
      const user = userEvent.setup();
      run('trainer.metronome');
      const button = screen.getByRole('button', { name: 'Toggle mixer' });
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

  describe('a full-window screen', () => {
    it('takes focus, makes the player inert, and gives focus back on Escape', async () => {
      const { run } = renderApp();
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', { name: 'Toggle tracks' });
      toggle.focus();
      run('library.show');
      const region = screen.getByRole('region', { name: 'Library' });
      expect(region).toHaveFocus();
      expect(screen.getByRole('main', { name: 'Score' }).closest('[inert]')).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('region', { name: 'Library' })).not.toBeInTheDocument();
      expect(toggle).toHaveFocus();
      expect(screen.getByRole('main', { name: 'Score' }).closest('[inert]')).toBeNull();
    });
  });
});
