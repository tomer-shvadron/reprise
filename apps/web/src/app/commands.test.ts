import { write } from '@reprise/formats';
import { largeScore } from '@reprise/model/testing';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { runCommand, type Command } from './command-registry';
import { installShortcutDispatcher } from './shortcut-dispatcher';

describe('view.toggleViewMode', () => {
  it('flips between page and continuous view, and the layout follows', async () => {
    const services = createTestServices();
    const { ui, layout, document } = services;
    const command = createAppRegistry(services).get('view.toggleViewMode');
    if (!command) throw new Error('view.toggleViewMode is not registered');
    expect(command.shortcut).toEqual({ key: 'F4' });
    await document
      .getState()
      .openBytes('song.reprise', (await write(largeScore(1, 16), 'reprise')).bytes);
    // Continuous view lays every system out on one line; pages stack them.
    const rows = () => new Set(layout.getState().result?.systems.map(({ bbox }) => bbox.y)).size;
    expect(rows()).toBeGreaterThan(1);

    runCommand(command);
    expect(ui.getState().view.mode).toBe('continuous');
    expect(rows()).toBe(1);

    runCommand(command);
    expect(ui.getState().view.mode).toBe('paged');
    expect(rows()).toBeGreaterThan(1);
  });
});

describe('the app registry and edit mode', () => {
  it('follows the editing flag', () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    expect(registry.isActive('editing')).toBe(false);
    services.editing.getState().setEditing(true);
    expect(registry.isActive('editing')).toBe(true);
  });

  it('fires the editing command on its key while editing and transport otherwise', () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const transport = registry.get('transport.previousBeat');
    if (!transport) throw new Error('transport.previousBeat is not registered');
    const run = vi.fn();
    const move: Command = {
      id: 'editor.test',
      title: 'Cursor left',
      shortcut: { key: 'ArrowLeft' },
      context: 'editing',
      run,
    };
    registry.register(move);
    const spy = vi.spyOn(transport, 'run').mockImplementation(() => undefined);
    const off = installShortcutDispatcher(window, registry, 'other');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    services.editing.getState().setEditing(true);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });
});
