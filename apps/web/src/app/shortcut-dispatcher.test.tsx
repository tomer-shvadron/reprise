import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Slider } from '@/components/ui/slider';

import { CommandRegistry } from './command-registry';
import { formatShortcut, type KeyboardPlatform } from './keyboard';
import { installShortcutDispatcher } from './shortcut-dispatcher';

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
