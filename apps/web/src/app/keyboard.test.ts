import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { CommandRegistry } from './command-registry';
import {
  ariaKeyShortcuts,
  formatShortcut,
  matchesShortcut,
  shortcutOn,
  shortcutParts,
  type KeyboardPlatform,
} from './keyboard';
import { readKeyEvent } from './record-key';
import { dispatchShortcut } from './shortcut-dispatcher';

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
    // The live registry through the dispatcher, with every command's run replaced by a recorder:
    // what the key runs depends on registration order wherever two commands match one key.
    function runs(event: ReturnType<typeof key>, platform: KeyboardPlatform): string | undefined {
      const app = createAppRegistry(createTestServices(), platform);
      const ran: string[] = [];
      const registry = new CommandRegistry(
        () => true,
        (command) => app.shortcutOf(command),
      );
      for (const command of app.list()) {
        registry.register({
          ...command,
          enabled: () => true,
          run: () => void ran.push(command.id),
        });
      }
      const press = new KeyboardEvent('keydown', { ...event, cancelable: true });
      dispatchShortcut(press, registry, platform);
      return ran[0];
    }

    interface Sample {
      layout: string;
      event: ReturnType<typeof key>;
      mac?: boolean;
      runs: string | undefined;
    }
    const e = (k: string, code: string, init: Partial<KeyboardEvent> = {}) =>
      key({ key: k, code, ...init });
    const SAMPLES: Sample[] = [
      { layout: 'US dot', event: e('.', 'Period'), runs: 'editor.toggleDot' },
      { layout: 'US slash', event: e('/', 'Slash'), runs: 'editor.toggleTriplet' },
      { layout: 'US L', event: e('l', 'KeyL'), runs: 'editor.toggleTie' },
      { layout: 'US 5', event: e('5', 'Digit5'), runs: 'editor.fret5' },
      { layout: 'US numpad 5', event: e('5', 'Numpad5'), runs: 'editor.fret5' },
      { layout: 'US bracket', event: e('[', 'BracketLeft'), runs: 'editor.toggleRepeatStart' },
      { layout: 'Hebrew dot key', event: e('.', 'Slash'), runs: 'editor.toggleDot' },
      { layout: 'Hebrew slash key', event: e('/', 'KeyQ'), runs: 'editor.toggleTriplet' },
      { layout: 'Hebrew W key', event: e("'", 'KeyW'), runs: 'editor.effect.whammyVibrato' },
      { layout: 'Hebrew L key', event: e('ך', 'KeyL'), runs: 'editor.toggleTie' },
      { layout: 'Hebrew period key', event: e('ץ', 'Period'), runs: 'editor.toggleDot' },
      { layout: 'Hebrew semicolon key', event: e('ף', 'Semicolon'), runs: 'editor.effect.accent' },
      { layout: 'Hebrew comma key', event: e('ת', 'Comma'), runs: undefined },
      {
        layout: 'Russian shift+comma key',
        event: e('Б', 'Comma', { shiftKey: true }),
        runs: 'editor.effect.fadeIn',
      },
      { layout: 'Hebrew bracket', event: e(']', 'BracketLeft'), runs: 'editor.toggleRepeatStart' },
      { layout: 'AZERTY & (1)', event: e('&', 'Digit1'), runs: 'editor.fret1' },
      { layout: 'AZERTY " (3)', event: e('"', 'Digit3'), runs: 'editor.fret3' },
      { layout: "AZERTY ' (4)", event: e("'", 'Digit4'), runs: 'editor.fret4' },
      { layout: 'AZERTY ( (5)', event: e('(', 'Digit5'), runs: 'editor.fret5' },
      { layout: 'AZERTY - (6)', event: e('-', 'Digit6'), runs: 'editor.fret6' },
      { layout: 'AZERTY _ (8)', event: e('_', 'Digit8'), runs: 'editor.fret8' },
      { layout: 'AZERTY é (2)', event: e('é', 'Digit2'), runs: 'editor.fret2' },
      { layout: 'AZERTY ù', event: e('ù', 'Quote'), runs: undefined },
      { layout: 'AZERTY $', event: e('$', 'BracketRight'), runs: 'editor.toggleRepeatEnd' },
      {
        layout: 'AZERTY Ctrl+&',
        event: e('&', 'Digit1', { ctrlKey: true }),
        runs: 'editor.editVoice1',
      },
      {
        layout: 'AZERTY Alt+(',
        event: e('(', 'Digit5', { altKey: true }),
        runs: 'track.go5',
      },
      {
        layout: 'Mac French ! (8)',
        event: e('!', 'Digit8'),
        mac: true,
        runs: 'editor.fret8',
      },
      { layout: 'QWERTZ Z key', event: e('z', 'KeyY'), runs: undefined },
      { layout: 'QWERTZ ß', event: e('ß', 'Minus'), runs: undefined },
      { layout: 'QWERTZ dead acute', event: e('Dead', 'Equal'), runs: undefined },
      { layout: 'QWERTZ L', event: e('l', 'KeyL'), runs: 'editor.toggleTie' },
      { layout: 'Czech + (1)', event: e('+', 'Digit1'), runs: 'editor.fret1' },
      {
        layout: 'German + key',
        event: e('+', 'BracketRight'),
        runs: 'editor.durationShorterNumpad',
      },
      { layout: 'Numpad +', event: e('+', 'NumpadAdd'), runs: 'editor.durationShorterNumpad' },
      { layout: 'Czech č (4)', event: e('č', 'Digit4'), runs: 'editor.fret4' },
      { layout: 'Russian L key', event: e('д', 'KeyL'), runs: 'editor.toggleTie' },
      { layout: 'Russian comma key', event: e('б', 'Comma'), runs: undefined },
      { layout: 'Russian quote key', event: e('э', 'Quote'), runs: undefined },
      { layout: 'Russian dot key', event: e('.', 'Slash'), runs: 'editor.toggleDot' },
      { layout: 'Greek Q key', event: e(';', 'KeyQ'), runs: 'editor.effect.accent' },
      { layout: 'US-International dead quote', event: e('Dead', 'Quote'), runs: undefined },
      {
        layout: 'US-International shift+dead quote',
        event: e('Dead', 'Quote', { shiftKey: true }),
        runs: 'editor.effect.tremoloPicking',
      },
      { layout: 'Dvorak [', event: e('[', 'Minus'), runs: 'editor.toggleRepeatStart' },
      { layout: 'Dvorak ]', event: e(']', 'Equal'), runs: 'editor.toggleRepeatEnd' },
      {
        layout: 'Mac Spanish Option+] key',
        event: e(']', 'BracketRight', { altKey: true }),
        mac: true,
        runs: 'editor.toggleRepeatEnd',
      },
      {
        layout: 'German = (Shift+0)',
        event: e('=', 'Digit0', { shiftKey: true }),
        runs: 'editor.durationShorter',
      },
      {
        layout: 'Swedish ; (Shift+comma)',
        event: e(';', 'Comma', { shiftKey: true }),
        runs: 'editor.effect.accent',
      },
      {
        layout: 'German Ctrl+= (Shift+0)',
        event: e('=', 'Digit0', { ctrlKey: true, shiftKey: true }),
        runs: 'view.zoomIn',
      },
      {
        // Still insert bar: on a Mac the same press is the shifted binding's own (see the doc).
        layout: 'Mac German Cmd+= (Shift+0)',
        event: e('=', 'Digit0', { metaKey: true, shiftKey: true }),
        mac: true,
        runs: 'editor.insertBarBeforeMacEquals',
      },
      { layout: 'IME first key', event: e('Process', 'Comma'), runs: undefined },
      {
        layout: 'Mac US Option+L',
        event: e('¬', 'KeyL', { altKey: true }),
        mac: true,
        runs: 'editor.lyrics',
      },
      {
        layout: 'Mac US Option+B',
        event: e('∫', 'KeyB', { altKey: true }),
        mac: true,
        runs: 'trainer.metronomeToggle',
      },
      {
        layout: 'Mac German Option+L',
        event: e('@', 'KeyL', { altKey: true }),
        mac: true,
        runs: 'editor.lyrics',
      },
      {
        layout: 'Mac German Option+5',
        event: e('[', 'Digit5', { altKey: true }),
        mac: true,
        runs: 'track.go5',
      },
      {
        layout: 'Mac Nordic Option+7',
        event: e('|', 'Digit7', { altKey: true }),
        mac: true,
        runs: 'track.go7',
      },
      {
        layout: 'Mac Spanish Option+2',
        event: e('@', 'Digit2', { altKey: true }),
        mac: true,
        runs: 'track.go2',
      },
    ];

    it.each(SAMPLES)('$layout runs $runs', ({ event, mac, runs: expected }) => {
      expect(runs(event, mac ? 'mac' : 'other')).toBe(expected);
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

    const record = (event: ReturnType<typeof key>, platform: KeyboardPlatform) =>
      readKeyEvent({ ...event, repeat: false, isComposing: false }, platform);

    it('records a key the dispatcher then fires from the same press', () => {
      const unrecordable = [
        'IME first key',
        'QWERTZ dead acute',
        'US-International dead quote',
        'US-International shift+dead quote',
      ];
      for (const { layout, event, mac } of SAMPLES) {
        const platform: KeyboardPlatform = mac ? 'mac' : 'other';
        const read = record(event, platform);
        if (unrecordable.includes(layout)) {
          expect(read.kind, layout).not.toBe('key');
          continue;
        }
        if (read.kind !== 'key') throw new Error(`${layout} did not record: ${read.kind}`);
        const registry = new CommandRegistry(() => true);
        const ran: string[] = [];
        registry.register({
          id: 'test.recorded',
          title: 'Recorded',
          shortcut: {
            key: read.binding.key,
            ...(read.binding.mod && { mod: true }),
            ...(read.binding.shift && { shift: true }),
            ...(read.binding.alt && { alt: true }),
          },
          run: () => void ran.push('test.recorded'),
        });
        dispatchShortcut(
          new KeyboardEvent('keydown', { ...event, cancelable: true }),
          registry,
          platform,
        );
        expect(ran, layout).toEqual(['test.recorded']);
      }
    });

    it('records what the printed key means: W on Hebrew, 1 on AZERTY, Option on a German Mac', () => {
      expect(record(e("'", 'KeyW'), 'other')).toMatchObject({ kind: 'key', binding: { key: "'" } });
      expect(record(e('&', 'Digit1'), 'other')).toMatchObject({
        kind: 'key',
        binding: { key: '1' },
      });
      expect(record(e('б', 'Comma'), 'other')).toMatchObject({
        kind: 'key',
        binding: { key: 'б' },
      });
      expect(record(e('@', 'KeyL', { altKey: true }), 'mac')).toMatchObject({
        kind: 'key',
        binding: { key: 'l', alt: true },
      });
      expect(record(e('[', 'Digit5', { altKey: true }), 'mac')).toMatchObject({
        kind: 'key',
        binding: { key: '5', alt: true },
      });
    });

    it('records a bracket typed off the bracket keys as printed', () => {
      // Dvorak puts `[` and `]` on Minus and Equal.
      expect(record(e('[', 'Minus'), 'other')).toMatchObject({
        kind: 'key',
        binding: { key: '[' },
      });
      expect(record(e(']', 'Equal'), 'other')).toMatchObject({
        kind: 'key',
        binding: { key: ']' },
      });
      // Windows German AltGr+8 prints `[` on the 8 key, which records as the digit.
      expect(record(e('[', 'Digit8', { ctrlKey: true, altKey: true }), 'other')).toMatchObject({
        kind: 'key',
        binding: { key: '8', mod: true, alt: true },
      });
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
