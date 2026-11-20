import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';

import { createTestServices } from '@/test/services';

import { CommandPalette } from './command-palette';
import { CommandRegistry } from './command-registry';
import { formatShortcut, type KeyboardPlatform } from './keyboard';
import { installShortcutDispatcher, menuCommandAllowed } from './shortcut-dispatcher';

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

function setup(platform: KeyboardPlatform) {
  const registry = new CommandRegistry();
  const open = vi.fn();
  const toggle = vi.fn();
  registry.register({
    id: 'file.open',
    title: 'Open',
    shortcut: { key: 'o', mod: true },
    run: open,
  });
  registry.register({
    id: 'view.toggleTheme',
    title: 'Toggle theme',
    shortcut: { key: 'l', mod: true, shift: true },
    run: toggle,
  });
  uninstall = installShortcutDispatcher(window, registry, platform);
  return { open, toggle };
}

describe('shortcut dispatcher', () => {
  it('leaves a native command its key: it neither runs nor prevents the default, yet stays listed', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({
      id: 'editor.copy',
      title: 'Copy',
      shortcut: { key: 'c', mod: true },
      native: true,
      run,
    });
    uninstall = installShortcutDispatcher(window, registry, 'other');
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(registry.available().map(({ id }) => id)).toContain('editor.copy');
  });

  it('runs the command whose shortcut matches, with Cmd on macOS', () => {
    const { open, toggle } = setup('mac');

    const event = new KeyboardEvent('keydown', {
      key: 'o',
      code: 'KeyO',
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(open).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('uses Ctrl elsewhere', () => {
    const { toggle } = setup('other');

    fireEvent.keyDown(window, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true });

    expect(toggle).toHaveBeenCalledOnce();
  });

  it('matches the physical key, so a non-Latin layout still triggers', () => {
    const { open } = setup('mac');

    fireEvent.keyDown(window, { key: 'ם', code: 'KeyO', metaKey: true });

    expect(open).toHaveBeenCalledOnce();
  });

  it('matches the printed key on a Latin layout that is not QWERTY', () => {
    const { open } = setup('mac');

    // Dvorak: the key printed O sits on physical KeyS, and physical KeyO prints R.
    fireEvent.keyDown(window, { key: 'o', code: 'KeyS', metaKey: true });
    expect(open).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'r', code: 'KeyO', metaKey: true });
    expect(open).toHaveBeenCalledOnce();
  });

  it('falls back to the physical key when Option changes the character on macOS', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'view.zoom', title: 'Zoom', shortcut: { key: 'l', alt: true }, run });
    uninstall = installShortcutDispatcher(window, registry, 'mac');

    fireEvent.keyDown(window, { key: '¬', code: 'KeyL', altKey: true });

    expect(run).toHaveBeenCalledOnce();
  });

  it('does nothing for a keydown that matches no shortcut', () => {
    const { open, toggle } = setup('mac');

    fireEvent.keyDown(window, { key: 'o', code: 'KeyO' });
    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });

    expect(open).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it('stops dispatching once uninstalled', () => {
    const { open } = setup('other');
    uninstall?.();
    uninstall = undefined;

    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true });

    expect(open).not.toHaveBeenCalled();
  });
});

describe('bare keys on focused controls', () => {
  function bare() {
    const registry = new CommandRegistry();
    const play = vi.fn();
    const slower = vi.fn();
    registry.register({
      id: 'play',
      title: 'Play',
      shortcut: { key: ' ' },
      repeat: false,
      run: play,
    });
    registry.register({ id: 'slower', title: 'Slower', shortcut: { key: '[' }, run: slower });
    uninstall = installShortcutDispatcher(window, registry, 'mac');
    return { play, slower };
  }

  it('leaves Space and Enter to a focused button or switch', () => {
    const { play, slower } = bare();
    const button = document.createElement('button');
    const toggle = document.createElement('div');
    toggle.setAttribute('role', 'switch');
    document.body.append(button, toggle);

    fireEvent.keyDown(button, { key: ' ', code: 'Space' });
    fireEvent.keyDown(toggle, { key: ' ', code: 'Space' });
    expect(play).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: '[', code: 'BracketLeft' });
    expect(slower).toHaveBeenCalledOnce();
    button.remove();
    toggle.remove();
  });

  it('leaves a typed character to an open menu, not to a closing one', () => {
    const { slower } = bare();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    menu.append(item);
    document.body.append(menu);

    menu.setAttribute('data-state', 'open');
    fireEvent.keyDown(item, { key: '[', code: 'BracketLeft' });
    expect(slower).not.toHaveBeenCalled();

    // Closing: focus may still sit in it, but it no longer takes typeahead.
    menu.setAttribute('data-state', 'closed');
    fireEvent.keyDown(item, { key: '[', code: 'BracketLeft' });
    expect(slower).toHaveBeenCalledOnce();
    menu.remove();
  });

  it('plays from the body and swallows a held Space without repeating it', () => {
    const { play, slower } = bare();
    const first = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(first);
    expect(play).toHaveBeenCalledOnce();
    expect(first.defaultPrevented).toBe(true);

    const held = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(held);
    expect(play).toHaveBeenCalledOnce();
    expect(held.defaultPrevented).toBe(true);

    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft', repeat: true });
    expect(slower).toHaveBeenCalledOnce();
  });
});

describe('navigation keys', () => {
  function arrows() {
    const registry = new CommandRegistry();
    const next = vi.fn();
    const previousBar = vi.fn();
    registry.register({ id: 'next', title: 'Next', shortcut: { key: 'ArrowRight' }, run: next });
    registry.register({
      id: 'previousBar',
      title: 'Previous bar',
      shortcut: { key: 'ArrowLeft', mod: true },
      run: previousBar,
    });
    uninstall = installShortcutDispatcher(window, registry, 'mac');
    return { next, previousBar };
  }

  it('stay with a text field whatever the modifiers, and move the playhead elsewhere', () => {
    const { next, previousBar } = arrows();
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft', metaKey: true });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(previousBar).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    input.remove();

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', metaKey: true });
    expect(next).toHaveBeenCalledOnce();
    expect(previousBar).toHaveBeenCalledOnce();
  });

  it('stay with a slider, which handles them first', () => {
    const { next } = arrows();
    const onValueChange = vi.fn();
    render(
      <Slider
        aria-label="Speed"
        defaultValue={[100]}
        min={25}
        max={200}
        onValueChange={onValueChange}
      />,
    );
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('formatShortcut', () => {
  it('renders platform-specific labels', () => {
    const shortcut = { key: 'l', mod: true, shift: true };

    expect(formatShortcut(shortcut, 'mac')).toBe('⇧⌘L');
    expect(formatShortcut(shortcut, 'other')).toBe('Ctrl+Shift+L');
  });
});

describe('shortcut contexts', () => {
  function setupContexts() {
    let editing = false;
    const registry = new CommandRegistry(() => editing);
    const seek = vi.fn();
    const move = vi.fn();
    const only = vi.fn();
    registry.register({
      id: 'transport.back',
      title: 'Back',
      shortcut: { key: 'ArrowLeft' },
      run: seek,
    });
    registry.register({
      id: 'editor.left',
      title: 'Cursor left',
      shortcut: { key: 'ArrowLeft' },
      context: 'editing',
      run: move,
    });
    registry.register({
      id: 'editor.only',
      title: 'Only while editing',
      shortcut: { key: 'x' },
      context: 'editing',
      run: only,
    });
    uninstall = installShortcutDispatcher(window, registry, 'other');
    return {
      seek,
      move,
      only,
      setEditing: (value: boolean) => {
        editing = value;
      },
    };
  }

  it('keeps the arrows with transport when not editing', () => {
    const { seek, move, only } = setupContexts();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(move).not.toHaveBeenCalled();
    expect(only).not.toHaveBeenCalled();
  });

  it('runs the editing command instead while editing, and falls back for other keys', () => {
    const { seek, move, only, setEditing } = setupContexts();
    setEditing(true);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(move).toHaveBeenCalledTimes(1);
    expect(only).toHaveBeenCalledTimes(1);
    expect(seek).not.toHaveBeenCalled();

    setEditing(false);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it('leaves the arrows and bare keys to a focused text field while editing', () => {
    const { seek, move, only, setEditing } = setupContexts();
    setEditing(true);
    render(<input aria-label="name" />);
    const input = screen.getByLabelText('name');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'x' });
    expect(seek).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(only).not.toHaveBeenCalled();
  });
});

describe('text fields and open dialogs', () => {
  function setupGuards() {
    const registry = new CommandRegistry();
    const run = {
      palette: vi.fn(),
      back: vi.fn(),
      del: vi.fn(),
      undo: vi.fn(),
      open: vi.fn(),
    };
    registry.register({
      id: 'app.commandPalette',
      title: 'Palette',
      shortcut: { key: 'k', mod: true },
      run: run.palette,
    });
    registry.register({
      id: 'x.back',
      title: 'Back',
      shortcut: { key: 'Backspace', mod: true },
      run: run.back,
    });
    registry.register({
      id: 'x.del',
      title: 'Delete',
      shortcut: { key: 'Delete', mod: true },
      run: run.del,
    });
    registry.register({
      id: 'x.undo',
      title: 'Undo',
      shortcut: { key: 'z', mod: true },
      run: run.undo,
    });
    registry.register({
      id: 'x.open',
      title: 'Open bracket',
      shortcut: { key: '[' },
      run: run.open,
    });
    uninstall = installShortcutDispatcher(window, registry, 'mac');
    return run;
  }

  function mountDialog() {
    return render(
      <div role="dialog" data-state="open">
        <button type="button">Dialog control</button>
        <input aria-label="Field" />
      </div>,
    );
  }

  it('keeps Backspace and Delete, with modifiers, for a text field', () => {
    const run = setupGuards();
    render(<input aria-label="Search" />);
    const input = screen.getByLabelText('Search');

    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace', metaKey: true });
    fireEvent.keyDown(input, { key: 'Delete', code: 'Delete', metaKey: true });

    expect(run.back).not.toHaveBeenCalled();
    expect(run.del).not.toHaveBeenCalled();
  });

  it('still runs Cmd+Backspace and Delete from the body', () => {
    const run = setupGuards();

    fireEvent.keyDown(document.body, { key: 'Backspace', code: 'Backspace', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete', metaKey: true });

    expect(run.back).toHaveBeenCalledOnce();
    expect(run.del).toHaveBeenCalledOnce();
  });

  it('runs nothing while a modal dialog is open, not even the palette toggle over it', () => {
    const run = setupGuards();
    mountDialog();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Dialog control' }), {
      key: '[',
      code: 'BracketLeft',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Dialog control' }), {
      key: 'z',
      code: 'KeyZ',
      metaKey: true,
    });
    // Focus has drifted to the body behind the dialog.
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(run.open).not.toHaveBeenCalled();
    expect(run.undo).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Dialog control' }), {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    });
    expect(run.palette).not.toHaveBeenCalled();
  });

  it('swallows a blocked match outside a text field, but leaves a text field its key', () => {
    setupGuards();
    mountDialog();

    const outside = new KeyboardEvent('keydown', {
      key: 'z',
      code: 'KeyZ',
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    screen.getByRole('button', { name: 'Dialog control' }).dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);

    const inField = new KeyboardEvent('keydown', {
      key: 'z',
      code: 'KeyZ',
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    screen.getByLabelText('Field').dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
  });

  it('lets Cmd+K close the palette but not open it over another dialog', () => {
    const run = setupGuards();
    const { unmount } = render(<div role="dialog" data-state="open" data-command-palette="" />);
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(run.palette).toHaveBeenCalledOnce();
    unmount();

    render(
      <>
        <div role="dialog" data-state="open" data-command-palette="" />
        <div role="alertdialog" data-state="open" />
      </>,
    );
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(run.palette).toHaveBeenCalledOnce();
  });

  it('is not blocked by a dialog that is closing', () => {
    const run = setupGuards();
    render(<div role="dialog" data-state="closed" />);

    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });

    expect(run.open).toHaveBeenCalledOnce();
  });

  it('blocks under the markup the real palette and a real Radix dialog render', async () => {
    const run = setupGuards();
    const services = createTestServices();
    const { ui } = services;
    ui.getState().setPaletteOpen(true);
    const registry = new CommandRegistry();
    registry.register({
      id: 'app.commandPalette',
      title: 'Palette',
      shortcut: { key: 'k', mod: true },
      run: run.palette,
    });
    registry.register({
      id: 'x.open',
      title: 'Open bracket',
      shortcut: { key: '[' },
      run: run.open,
    });
    registry.register({
      id: 'x.back',
      title: 'Back',
      shortcut: { key: 'Backspace', mod: true },
      run: run.back,
    });
    const { unmount } = render(
      <CommandPalette registry={registry} ui={ui} keyboard="mac" services={services} />,
    );
    const input = await screen.findByPlaceholderText('Type a command…');
    expect(menuCommandAllowed('file.open')).toBeFalsy();

    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace', metaKey: true });
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(run.back).not.toHaveBeenCalled();
    expect(run.open).not.toHaveBeenCalled();

    // The palette alone: Cmd+K goes through (it closes the palette).
    uninstall?.();
    uninstall = installShortcutDispatcher(window, registry, 'mac');
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', metaKey: true });
    expect(run.palette).toHaveBeenCalledOnce();
    unmount();

    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Print</DialogTitle>
          <DialogDescription>Options</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(run.open).not.toHaveBeenCalled();
    expect(menuCommandAllowed('edit.undo')).toBeFalsy();
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(run.palette).toHaveBeenCalledOnce();
  });

  it('lets Cmd+G through the open palette, which switches it to bar mode', async () => {
    const services = createTestServices();
    const { ui } = services;
    const registry = new CommandRegistry();
    const run = vi.fn(() => {
      ui.getState().openPalette('bar');
    });
    registry.register({
      id: 'app.goToBar',
      title: 'Go to bar…',
      shortcut: { key: 'g', mod: true },
      run,
    });
    uninstall = installShortcutDispatcher(window, registry, 'mac');
    ui.getState().setPaletteOpen(true);
    render(<CommandPalette registry={registry} ui={ui} keyboard="mac" services={services} />);
    const input = await screen.findByPlaceholderText('Type a command…');
    fireEvent.keyDown(input, { key: 'g', code: 'KeyG', metaKey: true });
    expect(run).toHaveBeenCalledOnce();
    expect(await screen.findByPlaceholderText(/^Bar number/)).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('treats an aria-modal alertdialog as modal and a popover as not', () => {
    const run = setupGuards();
    const { unmount } = render(<div role="alertdialog" aria-modal="true" />);
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(run.open).not.toHaveBeenCalled();
    unmount();

    render(
      <div data-radix-popper-content-wrapper="">
        <div role="dialog" data-state="open" />
      </div>,
    );
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(run.open).toHaveBeenCalledOnce();
  });

  it('runs normal shortcuts with no dialog open', () => {
    const run = setupGuards();

    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', metaKey: true });

    expect(run.open).toHaveBeenCalledOnce();
    expect(run.undo).toHaveBeenCalledOnce();
  });
});
