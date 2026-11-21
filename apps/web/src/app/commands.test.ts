import { write } from '@reprise/formats';
import { fullScore, largeScore } from '@reprise/model/testing';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CHORD_DIAGRAMS_SETTING, CHORD_STRIP_SETTING, THEME_SETTING } from '@/state/app-settings';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';
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

describe('view.toggleChordDiagrams', () => {
  it('flips the setting, and the layout follows with one re-layout per toggle', async () => {
    const services = createTestServices();
    const { layout, document, settings } = services;
    const command = createAppRegistry(services).get('view.toggleChordDiagrams');
    if (!command) throw new Error('view.toggleChordDiagrams is not registered');
    expect(command.shortcut).toBeUndefined();
    await document
      .getState()
      .openBytes('song.reprise', (await write(fullScore(), 'reprise')).bytes);
    const diagrams = () =>
      layout
        .getState()
        .result?.primitives.filter((p) => p.kind === 'path' && p.lane === 'chordDiagram').length;
    const changes = vi.fn();
    layout.subscribe(changes);
    expect(diagrams()).toBeGreaterThan(0);

    runCommand(command);
    expect(settings.get(CHORD_DIAGRAMS_SETTING)).toBe(false);
    expect(diagrams()).toBe(0);
    expect(changes).toHaveBeenCalledTimes(1);

    runCommand(command);
    expect(diagrams()).toBeGreaterThan(0);
    expect(changes).toHaveBeenCalledTimes(2);
  });
});

describe('view.toggleChordStrip', () => {
  it('flips the strip setting, off until turned on, with no default key', () => {
    const services = createTestServices();
    const command = createAppRegistry(services).get('view.toggleChordStrip');
    if (!command) throw new Error('view.toggleChordStrip is not registered');
    expect(command.shortcut).toBeUndefined();
    expect(services.settings.get(CHORD_STRIP_SETTING)).toBe(false);
    runCommand(command);
    expect(services.settings.get(CHORD_STRIP_SETTING)).toBe(true);
    runCommand(command);
    expect(services.settings.get(CHORD_STRIP_SETTING)).toBe(false);
  });
});

describe('view.toggleTheme', () => {
  it('stores the opposite of the theme on screen, even from system', () => {
    const services = createTestServices();
    const { ui, settings } = services;
    const command = createAppRegistry(services).get('view.toggleTheme');
    if (!command) throw new Error('view.toggleTheme is not registered');
    expect(settings.get(THEME_SETTING)).toBe('system');
    expect(ui.getState().theme).toBe('dark');

    runCommand(command);
    expect(settings.get(THEME_SETTING)).toBe('light');
    ui.getState().setTheme('light');
    runCommand(command);
    expect(settings.get(THEME_SETTING)).toBe('dark');
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
    // WP-080's command on the key transport also binds; its own tests cover what it does.
    const move = registry.get('editor.previousBeat');
    if (!move) throw new Error('editor.previousBeat is not registered');
    const run = vi.spyOn(move, 'run').mockImplementation(() => undefined);
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

describe('app.settings', () => {
  it('opens Settings from its shortcut and is listed in the palette', () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const command = registry.get('app.settings');
    if (!command) throw new Error('app.settings is not registered');
    expect(command.title).toBe('Settings…');
    expect(command.shortcut).toEqual({ key: ',', mod: true });
    expect(command.inPalette).not.toBe(false);

    const stop = installShortcutDispatcher(window, registry, 'mac');
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    stop();

    expect(services.ui.getState().settings.open).toBe(true);
  });
});
