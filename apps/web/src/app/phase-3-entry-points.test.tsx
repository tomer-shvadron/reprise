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
    expect(screen.getByRole('region', { name: 'Sounds' })).toHaveTextContent('WP-091');
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

  it.each([
    ['trainer.tuner', 'WP-071'],
    ['trainer.metronome', 'WP-072'],
    ['trainer.fretboard', 'WP-074'],
  ])('%s opens the right panel on its placeholder', (id, workPackage) => {
    const { run } = renderApp();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    run(id);
    expect(screen.getByRole('complementary', { name: 'Panel' })).toHaveTextContent(workPackage);
  });

  it('switches the right panel back to the mixer', () => {
    const { services, run } = renderApp();
    run('trainer.tuner');
    act(() => {
      services.ui.getState().showPanelView('mixer');
    });
    expect(screen.getByRole('complementary', { name: 'Panel' })).not.toHaveTextContent('WP-071');
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
      run('trainer.tuner');
      await user.keyboard('{F8}');
      expect(services.ui.getState().rightPanelView).toBe('mixer');
      expect(screen.getByRole('complementary', { name: 'Panel' })).not.toHaveTextContent('WP-071');
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
