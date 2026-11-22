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
  type Shortcut,
} from './keyboard';
import { readKeyEvent } from './record-key';

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

  describe('layouts', () => {
    const BINDINGS: readonly (readonly [string, Shortcut])[] = [
      ...Array.from({ length: 10 }, (_, i) => String(i)).map(
        (d) => [`fret${d}`, { key: d }] as const,
      ),
      ['voice1', { key: '1', mod: true }],
      ...Array.from({ length: 9 }, (_, i) => String(i + 1)).map(
        (d) => [`track${d}`, { key: d, alt: true }] as const,
      ),
      ['longer', { key: '-' }],
      ['shorter', { key: '=' }],
      ['dot', { key: '.' }],
      ['triplet', { key: '/' }],
      ['tie', { key: 'l' }],
      ['whammyVibrato', { key: 'w' }],
      ['accent', { key: ';' }],
      ['accentShifted', { key: ':', shift: true }],
      ['accentBare', { key: ':' }],
      ['staccato', { key: '!', shift: true }],
      ['staccatoBare', { key: '!' }],
      ['tremolo', { key: '"', shift: true }],
      ['tremoloBare', { key: '"' }],
      ['slap', { key: '$', shift: true }],
      ['slapBare', { key: '$' }],
      ['fadeIn', { key: '<', shift: true }],
      ['fadeInBare', { key: '<' }],
      ['fadeOut', { key: '>', shift: true }],
      ['fadeOutBare', { key: '>' }],
      ['repeatStart', { key: '[' }],
      ['repeatEnd', { key: ']' }],
      ['lyrics', { key: 'l', alt: true }],
      ['metronome', { key: 'b', alt: true }],
    ];

    // The dispatcher's rule: what the key prints decides first, the physical key only if nothing
    // matched by character.
    function resolve(event: ReturnType<typeof key>, platform: KeyboardPlatform): string[] {
      const by = (match: 'character' | 'physical') =>
        BINDINGS.filter(([, shortcut]) => matchesShortcut(event, shortcut, platform, match)).map(
          ([name]) => name,
        );
      const printed = by('character');
      return printed.length > 0 ? printed : by('physical');
    }

    interface Sample {
      layout: string;
      event: ReturnType<typeof key>;
      mac?: boolean;
      fires: string[];
    }
    const e = (k: string, code: string, init: Partial<KeyboardEvent> = {}) =>
      key({ key: k, code, ...init });
    const SAMPLES: Sample[] = [
      { layout: 'US dot', event: e('.', 'Period'), fires: ['dot'] },
      { layout: 'US slash', event: e('/', 'Slash'), fires: ['triplet'] },
      { layout: 'US L', event: e('l', 'KeyL'), fires: ['tie'] },
      { layout: 'US 5', event: e('5', 'Digit5'), fires: ['fret5'] },
      { layout: 'US numpad 5', event: e('5', 'Numpad5'), fires: ['fret5'] },
      { layout: 'US bracket', event: e('[', 'BracketLeft'), fires: ['repeatStart'] },
      { layout: 'Hebrew dot key', event: e('.', 'Slash'), fires: ['dot'] },
      { layout: 'Hebrew slash key', event: e('/', 'KeyQ'), fires: ['triplet'] },
      { layout: 'Hebrew W key', event: e("'", 'KeyW'), fires: ['whammyVibrato'] },
      { layout: 'Hebrew L key', event: e('ך', 'KeyL'), fires: ['tie'] },
      { layout: 'Hebrew period key', event: e('ץ', 'Period'), fires: ['dot'] },
      { layout: 'Hebrew semicolon key', event: e('ף', 'Semicolon'), fires: ['accent'] },
      { layout: 'Hebrew comma key', event: e('ת', 'Comma'), fires: [] },
      {
        layout: 'Hebrew shift+comma key',
        event: e('ת', 'Comma', { shiftKey: true }),
        fires: ['fadeIn'],
      },
      { layout: 'Hebrew bracket', event: e(']', 'BracketLeft'), fires: ['repeatStart'] },
      { layout: 'AZERTY & (1)', event: e('&', 'Digit1'), fires: ['fret1'] },
      { layout: 'AZERTY " (3)', event: e('"', 'Digit3'), fires: ['fret3', 'tremoloBare'] },
      { layout: "AZERTY ' (4)", event: e("'", 'Digit4'), fires: ['fret4'] },
      { layout: 'AZERTY ( (5)', event: e('(', 'Digit5'), fires: ['fret5'] },
      { layout: 'AZERTY - (6)', event: e('-', 'Digit6'), fires: ['fret6', 'longer'] },
      { layout: 'AZERTY _ (8)', event: e('_', 'Digit8'), fires: ['fret8'] },
      { layout: 'AZERTY é (2)', event: e('é', 'Digit2'), fires: ['fret2'] },
      { layout: 'AZERTY ù', event: e('ù', 'Quote'), fires: [] },
      { layout: 'AZERTY $', event: e('$', 'BracketRight'), fires: ['slapBare', 'repeatEnd'] },
      {
        layout: 'AZERTY Ctrl+&',
        event: e('&', 'Digit1', { ctrlKey: true }),
        fires: ['voice1'],
      },
      {
        layout: 'AZERTY Alt+(',
        event: e('(', 'Digit5', { altKey: true }),
        fires: ['track5'],
      },
      {
        layout: 'Mac French ! (8)',
        event: e('!', 'Digit8'),
        mac: true,
        fires: ['fret8', 'staccatoBare'],
      },
      { layout: 'QWERTZ Z key', event: e('z', 'KeyY'), fires: [] },
      { layout: 'QWERTZ ß', event: e('ß', 'Minus'), fires: [] },
      { layout: 'QWERTZ dead acute', event: e('Dead', 'Equal'), fires: [] },
      { layout: 'QWERTZ L', event: e('l', 'KeyL'), fires: ['tie'] },
      { layout: 'Czech + (1)', event: e('+', 'Digit1'), fires: ['fret1'] },
      { layout: 'Czech č (4)', event: e('č', 'Digit4'), fires: ['fret4'] },
      { layout: 'Russian L key', event: e('д', 'KeyL'), fires: ['tie'] },
      { layout: 'Russian comma key', event: e('б', 'Comma'), fires: [] },
      { layout: 'Russian quote key', event: e('э', 'Quote'), fires: [] },
      { layout: 'Russian dot key', event: e('.', 'Slash'), fires: ['dot'] },
      { layout: 'Greek Q key', event: e(';', 'KeyQ'), fires: ['accent'] },
      { layout: 'US-International dead quote', event: e('Dead', 'Quote'), fires: [] },
      { layout: 'IME first key', event: e('Process', 'Comma'), fires: [] },
      {
        layout: 'Mac US Option+L',
        event: e('¬', 'KeyL', { altKey: true }),
        mac: true,
        fires: ['lyrics'],
      },
      {
        layout: 'Mac US Option+B',
        event: e('∫', 'KeyB', { altKey: true }),
        mac: true,
        fires: ['metronome'],
      },
      {
        layout: 'Mac German Option+L',
        event: e('@', 'KeyL', { altKey: true }),
        mac: true,
        fires: ['lyrics'],
      },
      {
        layout: 'Mac German Option+5',
        event: e('[', 'Digit5', { altKey: true }),
        mac: true,
        fires: ['track5'],
      },
      {
        layout: 'Mac Nordic Option+7',
        event: e('|', 'Digit7', { altKey: true }),
        mac: true,
        fires: ['track7'],
      },
      {
        layout: 'Mac Spanish Option+2',
        event: e('@', 'Digit2', { altKey: true }),
        mac: true,
        fires: ['track2'],
      },
    ];

    it.each(SAMPLES)('$layout fires $fires', ({ event, mac, fires }) => {
      expect(resolve(event, mac ? 'mac' : 'other')).toEqual(fires);
    });

    it('does not run a shifted spelling from the key that prints a letter in its place', () => {
      expect(matchesShortcut(e('ת', 'Comma'), { key: '<' }, 'other')).toBe(false);
      expect(matchesShortcut(e('ף', 'Semicolon'), { key: ':' }, 'other')).toBe(false);
      expect(
        matchesShortcut(
          e('ף', 'Semicolon', { shiftKey: true }),
          { key: ':', shift: true },
          'other',
        ),
      ).toBe(true);
    });

    it('records the keys it then matches, so a recorded key fires when pressed', () => {
      const recordable = SAMPLES.filter(({ event }) => event.key !== 'Process');
      for (const { event, mac } of recordable) {
        const platform: KeyboardPlatform = mac ? 'mac' : 'other';
        const read = readKeyEvent({ ...event, repeat: false, isComposing: false }, platform);
        if (read.kind !== 'key') continue;
        expect(
          matchesShortcut(
            event,
            {
              key: read.binding.key,
              mod: Boolean(read.binding.mod),
              shift: Boolean(read.binding.shift),
              alt: Boolean(read.binding.alt),
            },
            platform,
          ),
          `${event.key} ${event.code}`,
        ).toBe(true);
      }
      expect(
        readKeyEvent({ ...e("'", 'KeyW'), repeat: false, isComposing: false }, 'other'),
      ).toMatchObject({ kind: 'key', binding: { key: "'" } });
      expect(
        readKeyEvent({ ...e('&', 'Digit1'), repeat: false, isComposing: false }, 'other'),
      ).toMatchObject({ kind: 'key', binding: { key: '1' } });
      expect(
        readKeyEvent(
          { ...e('@', 'KeyL', { altKey: true }), repeat: false, isComposing: false },
          'mac',
        ),
      ).toMatchObject({ kind: 'key', binding: { key: 'l', alt: true } });
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
