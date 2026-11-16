import type { Command } from '@/app/command-registry';
import { detectKeyboardPlatform } from '@/app/keyboard';

import {
  deleteTargetBars,
  insertBarAt,
  openMasterBarDialog,
  toggleRepeatEnd,
  toggleRepeatStart,
  type BarServices,
} from './bar-actions';
import type { MasterBarSection } from './dialogs';

export type BarCommandId =
  | 'editor.insertBarBeforeMac'
  | 'editor.insertBarBeforeMacShift'
  | 'editor.insertBarBeforeWindows'
  | 'editor.insertBarAfter'
  | 'editor.deleteBarsMac'
  | 'editor.deleteBarsWindows'
  | 'editor.toggleRepeatStart'
  | 'editor.toggleRepeatEnd'
  | 'editor.barProperties'
  | 'editor.keySignature'
  | 'editor.tempoChange'
  | 'editor.repeatsAndEndings'
  | 'editor.directions'
  | 'editor.section';

type BarCommand = Command & { id: BarCommandId };

/**
 * Bar management, all in the editing context where a cursor gives the target: the bar under it,
 * or every bar a range touches. The keys are Guitar Pro's where it has one. `[` and `]` shadow
 * the transport's tempo steps while editing (decision 11b), and Insert is the Windows key for a
 * bar, so the insert-or-overwrite toggle stays in the palette. Alone, a refusal reads on the
 * edit status line.
 */
export function barCommands(services: BarServices): BarCommand[] {
  const mac = detectKeyboardPlatform() === 'mac';
  const command = (
    id: BarCommandId,
    title: string,
    run: () => void,
    extra: Partial<Pick<Command, 'shortcut' | 'inPalette' | 'repeat'>> = {},
  ): BarCommand => ({ id, title, context: 'editing', run, ...extra });
  const hidden = { inPalette: false } as const;
  const before = () => {
    insertBarAt(services, 'before');
  };
  const remove = () => {
    deleteTargetBars(services);
  };
  const dialog = (focus?: MasterBarSection) => () => {
    openMasterBarDialog(services, focus);
  };

  return [
    // ⌘+ is a shifted key on most layouts, so both spellings are bound; Windows has Insert.
    command('editor.insertBarBeforeMac', 'Insert bar before', before, {
      shortcut: { key: '+', mod: true, only: 'mac' },
      inPalette: mac,
    }),
    command('editor.insertBarBeforeMacShift', 'Insert bar before', before, {
      shortcut: { key: '+', mod: true, shift: true, only: 'mac' },
      ...hidden,
    }),
    command('editor.insertBarBeforeWindows', 'Insert bar before', before, {
      shortcut: { key: 'Insert', only: 'other' },
      inPalette: !mac,
    }),
    command('editor.insertBarAfter', 'Insert bar after', () => {
      insertBarAt(services, 'after');
    }),
    // ⌃- is not bindable on a Mac (`mod` is ⌘), so ⌘⌫, the macOS delete idiom.
    command('editor.deleteBarsMac', 'Delete bars', remove, {
      shortcut: { key: 'Backspace', mod: true, only: 'mac' },
      inPalette: mac,
    }),
    command('editor.deleteBarsWindows', 'Delete bars', remove, {
      shortcut: { key: 'Delete', mod: true, only: 'other' },
      inPalette: !mac,
    }),
    command(
      'editor.toggleRepeatStart',
      'Toggle repeat start',
      () => {
        toggleRepeatStart(services);
      },
      { shortcut: { key: '[' } },
    ),
    command(
      'editor.toggleRepeatEnd',
      'Toggle repeat end',
      () => {
        toggleRepeatEnd(services);
      },
      { shortcut: { key: ']' } },
    ),
    command('editor.barProperties', 'Bar properties…', dialog(), {
      shortcut: { key: 't', mod: true },
      repeat: false,
    }),
    command('editor.keySignature', 'Key signature…', dialog('key')),
    command('editor.tempoChange', 'Tempo change…', dialog('tempo')),
    command('editor.repeatsAndEndings', 'Repeats and endings…', dialog('repeats')),
    command('editor.directions', 'Directions…', dialog('directions'), {
      shortcut: { key: 'd' },
      repeat: false,
    }),
    command('editor.section', 'Section…', dialog('section')),
  ];
}
