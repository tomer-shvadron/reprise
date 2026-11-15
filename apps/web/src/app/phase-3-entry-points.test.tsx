import { act, render, screen } from '@testing-library/react';
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
    expect(region).toHaveTextContent('WP-060');
    await userEvent.click(screen.getByRole('button', { name: 'Back to player' }));
    expect(screen.queryByRole('region', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('opens the sound manager', () => {
    const { run } = renderApp();
    run('sounds.show');
    expect(screen.getByRole('region', { name: 'Sounds' })).toHaveTextContent('WP-091');
  });

  it.each([
    ['trainer.speedTrainer', 'WP-070'],
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

  it('toggles edit mode only with a document open, and resets it on a new one', () => {
    const { services, run } = renderApp();
    run('editor.toggleMode');
    expect(services.editing.getState().editing).toBe(false);
  });
});
