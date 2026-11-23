import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { CommandRegistry } from './command-registry';
import { dispatchShortcut } from './shortcut-dispatcher';
import { ShortcutSheet } from './shortcut-sheet';
import { joinKeys } from './shortcut-table';
import type { KeyboardPlatform } from './keyboard';

function setup(keyboard: KeyboardPlatform = 'other') {
  const { ui, settings } = createTestServices();
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
  registry.register({
    id: 'file.saveAs',
    title: 'Save as…',
    shortcut: { key: 's', mod: true, shift: true },
    run: () => undefined,
  });
  registry.register({ id: 'file.close', title: 'Close file', run: () => undefined });
  render(<ShortcutSheet registry={registry} ui={ui} settings={settings} keyboard={keyboard} />);
  return ui;
}

const open = (ui: ReturnType<typeof setup>) => {
  act(() => {
    ui.getState().setShortcutsOpen(true);
  });
};

describe('shortcut cheat sheet', () => {
  it('lists the effective keys of commands that have one, once opened', () => {
    const ui = setup();
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
    open(ui);
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('F7')).toBeTruthy();
    expect(screen.queryByText('Space')).toBeNull();
    expect(screen.getByText('Ctrl+S')).toBeTruthy();
    expect(screen.queryByText('Close file')).toBeNull();
  });

  it('filters by title or key, and starts empty on each opening', async () => {
    const ui = setup();
    open(ui);
    const box = screen.getByRole('textbox', { name: 'Filter shortcuts' });
    await userEvent.type(box, 'ctrl+s');
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByText('Play or pause')).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzz');
    expect(screen.getByText('No matching shortcut.')).toBeTruthy();
    act(() => {
      ui.getState().setShortcutsOpen(false);
    });
    open(ui);
    expect(screen.getByRole('textbox', { name: 'Filter shortcuts' })).toHaveProperty('value', '');
  });

  it('finds a command on macOS by the spelled-out modifier names', async () => {
    const ui = setup('mac');
    open(ui);
    const box = screen.getByRole('textbox', { name: 'Filter shortcuts' });
    await userEvent.type(box, 'cmd+shift+s');
    expect(screen.getByText('Save as…')).toBeTruthy();
    expect(screen.queryByText('Play or pause')).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, 'command s');
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('reads each key spelled out to a screen reader', () => {
    const ui = setup('mac');
    open(ui);
    expect(screen.getByLabelText('Command+Shift+S')).toBeTruthy();
  });
});

describe('the app’s ? and Ctrl+/ bindings', () => {
  function app(editing: boolean) {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    // The registry's context follows the editing store; the sheet is under test, not the editor.
    if (editing) services.editing.getState().setEditing(true);
    return { services, registry };
  }
  const key = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };

  it('does not open from a text field, but opens in edit mode', () => {
    const { services, registry } = app(false);
    const input = document.createElement('input');
    document.body.append(input);
    expect(dispatchShortcut(key(input, { key: '?', shiftKey: true }), registry, 'other')).toBe(
      false,
    );
    expect(services.ui.getState().shortcutsOpen).toBe(false);

    const editing = app(true);
    expect(
      dispatchShortcut(key(document.body, { key: '?', shiftKey: true }), editing.registry, 'other'),
    ).toBe(true);
    expect(editing.services.ui.getState().shortcutsOpen).toBe(true);
    input.remove();
  });

  it('opens on Ctrl+/ from inside a text field', () => {
    const { services, registry } = app(false);
    const input = document.createElement('input');
    document.body.append(input);
    expect(dispatchShortcut(key(input, { key: '/', ctrlKey: true }), registry, 'other')).toBe(true);
    expect(services.ui.getState().shortcutsOpen).toBe(true);
    input.remove();
  });

  it('closes on Escape and gives focus back, and closes again on Ctrl+/', async () => {
    const { services, registry } = app(false);
    render(
      <>
        <button type="button">before</button>
        <ShortcutSheet
          registry={registry}
          ui={services.ui}
          settings={services.settings}
          keyboard="other"
        />
      </>,
    );
    const button = screen.getByRole('button', { name: 'before' });
    button.focus();
    act(() => {
      dispatchShortcut(key(button, { key: '/', ctrlKey: true }), registry, 'other');
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(services.ui.getState().shortcutsOpen).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });

    act(() => {
      dispatchShortcut(key(button, { key: '/', ctrlKey: true }), registry, 'other');
    });
    act(() => {
      dispatchShortcut(key(document.body, { key: '/', ctrlKey: true }), registry, 'other');
    });
    expect(services.ui.getState().shortcutsOpen).toBe(false);
  });
});

describe('joinKeys', () => {
  it('writes a run of three or more digits as a range and drops repeats', () => {
    expect(joinKeys(['0', '1', '2', '3'])).toBe('0–3');
    expect(joinKeys(['1', '2'])).toBe('1 or 2');
    expect(joinKeys(['=', '+', '+'])).toBe('= or +');
    expect(joinKeys([])).toBe('—');
  });

  it('writes a run of letters as a range, shifted or not, and never joins them with digits', () => {
    expect(joinKeys(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A–G');
    expect(joinKeys(['⇧A', '⇧B', '⇧C'])).toBe('⇧A–C');
    expect(joinKeys(['Shift+A', 'Shift+B', 'Shift+C', 'Shift+D'])).toBe('Shift+A–D');
    expect(joinKeys(['A', 'B', '⇧C', '⇧D'])).toBe('A or B or ⇧C or ⇧D');
    expect(joinKeys(['B', 'C', '1', '2'])).toBe('B or C or 1 or 2');
  });
});
