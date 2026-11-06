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

  it('writes aria-keyshortcuts syntax', () => {
    expect(ariaKeyShortcuts({ key: 'F9', mod: true }, 'mac')).toBe('Meta+F9');
    expect(ariaKeyShortcuts({ key: 'F9', mod: true }, 'other')).toBe('Control+F9');
    expect(ariaKeyShortcuts({ key: ' ', shift: true }, 'mac')).toBe('Shift+Space');
    expect(ariaKeyShortcuts({ key: 'm', alt: true, shift: true }, 'mac')).toBe('Alt+Shift+M');
  });

  it('names the arrows and passes them to aria as KeyboardEvent names', () => {
    expect(formatShortcut({ key: 'ArrowDown', mod: true }, 'mac')).toBe('⌘↓');
    expect(formatShortcut({ key: 'ArrowUp', mod: true }, 'other')).toBe('Ctrl+↑');
    expect(ariaKeyShortcuts({ key: 'ArrowDown', mod: true }, 'mac')).toBe('Meta+ArrowDown');
  });

  it('matches a platform-only shortcut on its platform alone', () => {
    const redo = { key: 'y', mod: true, only: 'other' } as const;
    expect(matchesShortcut(key({ key: 'y', code: 'KeyY', ctrlKey: true }), redo, 'other')).toBe(
      true,
    );
    expect(matchesShortcut(key({ key: 'y', code: 'KeyY', metaKey: true }), redo, 'mac')).toBe(
      false,
    );
  });
});
