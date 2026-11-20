import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { CommandRegistry } from './command-registry';
import { dispatchShortcut } from './shortcut-dispatcher';
import { ShortcutSheet } from './shortcut-sheet';
import { joinKeys } from './shortcut-table';

function setup() {
  const { ui } = createTestServices();
  const registry = new CommandRegistry(
    () => false,
    // An override layer wraps the default here: Play answers to F7 now.
    (command) => (command.id === 'transport.play' ? { key: 'F7' } : command.shortcut),
  );
  registry.register({
    id: 'transport.play',
    title: 'Play or pause',
    shortcut: { key: ' ' },
    run: () => undefined,
  });
  registry.register({
    id: 'file.save',
    title: 'Save',
    shortcut: { key: 's', mod: true },
    run: () => undefined,
  });
  registry.register({ id: 'file.close', title: 'Close file', run: () => undefined });
  render(<ShortcutSheet registry={registry} ui={ui} keyboard="other" />);
  return ui;
}

describe('shortcut cheat sheet', () => {
  it('renders nothing while closed, then lists the effective keys of commands that have one', () => {
    const ui = setup();
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
    act(() => {
      ui.getState().setShortcutsOpen(true);
    });
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('F7')).toBeTruthy();
    expect(screen.queryByText('Space')).toBeNull();
    expect(screen.getByText('Ctrl+S')).toBeTruthy();
    expect(screen.queryByText('Close file')).toBeNull();
  });

  it('filters by title or key', async () => {
    const ui = setup();
    act(() => {
      ui.getState().setShortcutsOpen(true);
    });
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter shortcuts' }), 'ctrl+s');
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByText('Play or pause')).toBeNull();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Filter shortcuts' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter shortcuts' }), 'zzz');
    expect(screen.getByText('No matching shortcut.')).toBeTruthy();
  });

  it('opens on ?', () => {
    const { ui } = createTestServices();
    const registry = new CommandRegistry();
    registry.register({
      id: 'app.shortcuts',
      title: 'Show keyboard shortcuts',
      shortcut: { key: '?', shift: true },
      run: () => {
        ui.getState().setShortcutsOpen(true);
      },
    });
    const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true, cancelable: true });
    expect(dispatchShortcut(event, registry, 'other')).toBe(true);
    expect(ui.getState().shortcutsOpen).toBe(true);
  });
});

describe('joinKeys', () => {
  it('writes a run of three or more digits as a range and drops repeats', () => {
    expect(joinKeys(['0', '1', '2', '3'])).toBe('0–3');
    expect(joinKeys(['1', '2'])).toBe('1 or 2');
    expect(joinKeys(['=', '⇧=', '⇧='])).toBe('= or ⇧=');
    expect(joinKeys([])).toBe('—');
  });
});
