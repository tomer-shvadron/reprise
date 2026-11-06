import { describe, expect, it } from 'vitest';

import { ariaKeyShortcuts, formatShortcut, matchesShortcut } from './keyboard';

const key = (init: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe('keyboard', () => {
  it('matches brackets by their physical key, so the Hebrew layout does not swap them', () => {
    expect(matchesShortcut(key({ key: ']', code: 'BracketLeft' }), { key: '[' }, 'mac')).toBe(true);
    expect(matchesShortcut(key({ key: ']', code: 'BracketLeft' }), { key: ']' }, 'mac')).toBe(
      false,
    );
  });

  it('names Space, Enter and function keys', () => {
    expect(formatShortcut({ key: ' ' }, 'mac')).toBe('Space');
    expect(formatShortcut({ key: ' ', shift: true }, 'mac')).toBe('⇧Space');
    expect(formatShortcut({ key: 'Enter' }, 'mac')).toBe('↩');
    expect(formatShortcut({ key: 'Enter' }, 'other')).toBe('Enter');
    expect(formatShortcut({ key: 'F9', mod: true }, 'mac')).toBe('⌘F9');
    expect(formatShortcut({ key: 'F9', mod: true }, 'other')).toBe('Ctrl+F9');
  });

  it('names arrows, Home and End as Guitar Pro prints them on macOS', () => {
    expect(formatShortcut({ key: 'ArrowRight' }, 'mac')).toBe('→');
    expect(formatShortcut({ key: 'ArrowLeft', mod: true, shift: true }, 'mac')).toBe('⇧⌘←');
    expect(formatShortcut({ key: 'Home', mod: true }, 'mac')).toBe('⌘↖');
    expect(formatShortcut({ key: 'End', mod: true }, 'mac')).toBe('⌘↘');
    expect(formatShortcut({ key: 'ArrowLeft', mod: true }, 'other')).toBe('Ctrl+Left');
    expect(formatShortcut({ key: 'Home' }, 'other')).toBe('Home');
    expect(ariaKeyShortcuts({ key: 'ArrowRight' }, 'mac')).toBe('ArrowRight');
    expect(ariaKeyShortcuts({ key: 'Home', mod: true }, 'mac')).toBe('Meta+Home');
  });

  it('writes aria-keyshortcuts syntax', () => {
    expect(ariaKeyShortcuts({ key: 'F9', mod: true }, 'mac')).toBe('Meta+F9');
    expect(ariaKeyShortcuts({ key: 'F9', mod: true }, 'other')).toBe('Control+F9');
    expect(ariaKeyShortcuts({ key: ' ', shift: true }, 'mac')).toBe('Shift+Space');
    expect(ariaKeyShortcuts({ key: 'm', alt: true, shift: true }, 'mac')).toBe('Alt+Shift+M');
  });
});
