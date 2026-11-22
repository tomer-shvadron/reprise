import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import {
  ariaKeyShortcuts,
  formatShortcut,
  matchesShortcut,
  shortcutOn,
  shortcutParts,
  type KeyboardPlatform,
} from './keyboard';

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

  describe('non-US layouts', () => {
    // As a Hebrew layout reports them: the physical Slash key prints `.`, the physical Q key
    // prints `/`, the physical Period key prints a Hebrew letter.
    const hebrewDot = key({ key: '.', code: 'Slash' });
    const hebrewSlash = key({ key: '/', code: 'KeyQ' });
    const hebrewPeriodKey = key({ key: 'ץ', code: 'Period' });
    const hebrewSemicolonKey = key({ key: 'ף', code: 'Semicolon' });

    it('matches the printed punctuation character, so Hebrew dot and triplet follow the keycap', () => {
      expect(matchesShortcut(hebrewDot, { key: '.' }, 'mac')).toBe(true);
      expect(matchesShortcut(hebrewSlash, { key: '/' }, 'mac')).toBe(true);
      expect(matchesShortcut(hebrewSlash, { key: '.' }, 'mac')).toBe(false);
    });

    it('does not let a printed punctuation character trigger the letter on its physical key', () => {
      expect(matchesShortcut(hebrewSlash, { key: 'q' }, 'mac')).toBe(false);
      expect(matchesShortcut(key({ key: "'", code: 'KeyW' }), { key: 'w' }, 'mac')).toBe(false);
    });

    it('falls back to the physical key when the layout prints a non-ASCII character', () => {
      expect(matchesShortcut(hebrewPeriodKey, { key: '.' }, 'mac')).toBe(true);
      expect(matchesShortcut(hebrewSemicolonKey, { key: ';' }, 'mac')).toBe(true);
      expect(
        matchesShortcut(
          { ...hebrewSemicolonKey, shiftKey: true },
          { key: ':', shift: true },
          'mac',
        ),
      ).toBe(true);
      expect(matchesShortcut(hebrewPeriodKey, { key: ',' }, 'mac')).toBe(false);
      expect(matchesShortcut(key({ key: 'ש', code: 'KeyA' }), { key: 'a' }, 'mac')).toBe(true);
      expect(
        matchesShortcut(
          key({ key: '≈', code: 'KeyX', altKey: true }),
          { key: 'x', alt: true },
          'mac',
        ),
      ).toBe(true);
    });

    it('keeps AZERTY and QWERTZ keys by character, so $ and " do not become ] and 3', () => {
      const azertyDollar = key({ key: '$', code: 'BracketRight' });
      expect(matchesShortcut(azertyDollar, { key: '$' }, 'mac')).toBe(true);
      expect(matchesShortcut(azertyDollar, { key: '4' }, 'mac')).toBe(false);
      expect(matchesShortcut(key({ key: '"', code: 'Digit3' }), { key: '3' }, 'mac')).toBe(false);
      expect(matchesShortcut(key({ key: 'z', code: 'KeyY' }), { key: 'z' }, 'mac')).toBe(true);
      expect(matchesShortcut(key({ key: 'y', code: 'KeyZ' }), { key: 'z' }, 'mac')).toBe(false);
    });

    it('still matches a US layout by character', () => {
      expect(matchesShortcut(key({ key: '.', code: 'Period' }), { key: '.' }, 'mac')).toBe(true);
      expect(matchesShortcut(key({ key: '/', code: 'Slash' }), { key: '/' }, 'mac')).toBe(true);
      expect(matchesShortcut(key({ key: 'q', code: 'KeyQ' }), { key: 'q' }, 'mac')).toBe(true);
      expect(matchesShortcut(key({ key: '.', code: 'Period' }), { key: '/' }, 'mac')).toBe(false);
    });
  });

  it('matches mod+, as Cmd+comma on macOS and Ctrl+comma elsewhere', () => {
    const shortcut = { key: ',', mod: true };
    const event = (init: Partial<KeyboardEvent>) => key({ key: ',', code: 'Comma', ...init });
    expect(matchesShortcut(event({ metaKey: true }), shortcut, 'mac')).toBe(true);
    expect(matchesShortcut(event({ ctrlKey: true }), shortcut, 'mac')).toBe(false);
    expect(matchesShortcut(event({ ctrlKey: true }), shortcut, 'other')).toBe(true);
    expect(matchesShortcut(event({}), shortcut, 'other')).toBe(false);
    expect(formatShortcut(shortcut, 'mac')).toBe('⌘,');
    expect(formatShortcut(shortcut, 'other')).toBe('Ctrl+,');
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

  it('writes valid WAI-ARIA tokens for punctuation', () => {
    expect(ariaKeyShortcuts({ key: '+', mod: true }, 'mac')).toBe('Meta+Plus');
    expect(ariaKeyShortcuts({ key: '+', shift: true }, 'other')).toBe('Plus');
    expect(ariaKeyShortcuts({ key: '?', shift: true }, 'other')).toBe('Shift+/');
    expect(ariaKeyShortcuts({ key: ':', shift: true }, 'other')).toBe('Shift+;');
    expect(ariaKeyShortcuts({ key: '!', shift: true }, 'other')).toBe('Shift+1');
    expect(ariaKeyShortcuts({ key: '[' }, 'other')).toBe('[');
    expect(ariaKeyShortcuts({ key: '=' }, 'other')).toBe('=');
  });

  it('names the arrows and passes them to aria as KeyboardEvent names', () => {
    expect(formatShortcut({ key: 'ArrowDown', mod: true }, 'mac')).toBe('⌘↓');
    expect(formatShortcut({ key: 'ArrowUp', mod: true }, 'other')).toBe('Ctrl+Up');
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

  it('binds a platform-only shortcut, for every place that lists it, on its platform alone', () => {
    const redo = { key: 'y', mod: true, only: 'other' } as const;
    expect(shortcutOn(redo, 'other')).toBe(redo);
    expect(shortcutOn(redo, 'mac')).toBeUndefined();
    expect(shortcutOn({ key: 'z', mod: true }, 'mac')).toEqual({ key: 'z', mod: true });
    expect(shortcutOn(undefined, 'mac')).toBeUndefined();
  });

  it('splits a shortcut into one cap per key', () => {
    const save = { key: 's', mod: true, alt: true, shift: true };
    expect(shortcutParts(save, 'mac')).toEqual(['⌥', '⇧', '⌘', 'S']);
    expect(shortcutParts(save, 'other')).toEqual(['Ctrl', 'Alt', 'Shift', 'S']);
    expect(shortcutParts({ key: ' ' }, 'other')).toEqual(['Space']);
    // Punctuation does not print Shift.
    expect(shortcutParts({ key: '?', shift: true }, 'other')).toEqual(['?']);
  });

  it('prints every default binding as its parts joined', () => {
    const registry = createAppRegistry(createTestServices(), 'mac');
    for (const platform of ['mac', 'other'] as KeyboardPlatform[]) {
      for (const command of registry.list()) {
        const shortcut = shortcutOn(registry.shortcutOf(command), platform);
        if (!shortcut) continue;
        expect(shortcutParts(shortcut, platform).join(platform === 'mac' ? '' : '+')).toBe(
          formatShortcut(shortcut, platform),
        );
      }
    }
  });
});
