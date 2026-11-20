import type { Command } from '@/app/command-registry';
import { detectKeyboardPlatform, type Shortcut } from '@/app/keyboard';
import type { AppServices } from '@/app/services';

import type { EntryAction } from './entry';
import { entryController } from './entry-controller';

const FRET_IDS = [
  'editor.fret0',
  'editor.fret1',
  'editor.fret2',
  'editor.fret3',
  'editor.fret4',
  'editor.fret5',
  'editor.fret6',
  'editor.fret7',
  'editor.fret8',
  'editor.fret9',
] as const;

export type EntryCommandId =
  | (typeof FRET_IDS)[number]
  | 'editor.durationLonger'
  | 'editor.durationShorter'
  | 'editor.durationShorterPlus'
  | 'editor.durationShorterNumpad'
  | 'editor.toggleDot'
  | 'editor.toggleDoubleDot'
  | 'editor.toggleTriplet'
  | 'editor.toggleTie'
  | 'editor.rest'
  | 'editor.insertBeat'
  | 'editor.deleteNote'
  | 'editor.deleteNoteForward'
  | 'editor.deleteBeatMac'
  | 'editor.deleteBeatWindows'
  | 'editor.editVoice1'
  | 'editor.editVoice2'
  | 'editor.toggleInsertMode';

type EntryCommand = Command & { id: EntryCommandId };

/**
 * The note-entry keys of edit mode, Guitar Pro's where it has one. Each is a thin call into the
 * entry controller, which does nothing outside edit mode or without a cursor. The insert-or-
 * overwrite toggle has no key: Insert belongs to inserting a bar (WP-083), so it is palette-only.
 */
export function entryCommands(services: Pick<AppServices, 'entry'>): EntryCommand[] {
  const { entry } = services;
  const act = (action: EntryAction) => () => {
    entryController(entry)?.act(action);
  };
  const command = (
    id: EntryCommandId,
    title: string,
    shortcut: Shortcut | undefined,
    run: () => void,
    extra: Partial<Pick<Command, 'inPalette' | 'repeat' | 'rebindable'>> = {},
  ): EntryCommand => ({
    id,
    title,
    ...(shortcut && { shortcut }),
    context: 'editing',
    run,
    ...extra,
  });
  const hidden = { inPalette: false } as const;
  // The palette lists the one that has a key here, so its hint is the right one.
  const mac = detectKeyboardPlatform() === 'mac';

  return [
    ...FRET_IDS.map((id, digit) =>
      command(
        id,
        'Type fret digit',
        { key: String(digit) },
        () => {
          entryController(entry)?.fret(digit);
        },
        { ...hidden, repeat: false, rebindable: false },
      ),
    ),
    command('editor.durationLonger', 'Longer duration', { key: '-' }, act({ kind: 'longer' })),
    command('editor.durationShorter', 'Shorter duration', { key: '=' }, act({ kind: 'shorter' })),
    command(
      'editor.durationShorterPlus',
      'Shorter duration',
      { key: '+', shift: true },
      act({ kind: 'shorter' }),
      hidden,
    ),
    command(
      'editor.durationShorterNumpad',
      'Shorter duration',
      { key: '+' },
      act({ kind: 'shorter' }),
      hidden,
    ),
    command('editor.toggleDot', 'Toggle dot', { key: '.' }, act({ kind: 'dot' })),
    command(
      'editor.toggleDoubleDot',
      'Toggle double dot',
      { key: '.', mod: true },
      act({ kind: 'doubleDot' }),
    ),
    command('editor.toggleTriplet', 'Toggle triplet', { key: '/' }, act({ kind: 'triplet' })),
    command('editor.toggleTie', 'Toggle tie', { key: 'l' }, act({ kind: 'tie' })),
    command('editor.rest', 'Rest', { key: 'r' }, act({ kind: 'rest' })),
    command(
      'editor.insertBeat',
      'Insert beat after',
      { key: 'Enter' },
      act({ kind: 'insertAfter' }),
    ),
    command('editor.deleteNote', 'Delete note', { key: 'Backspace' }, act({ kind: 'deleteNote' })),
    command(
      'editor.deleteNoteForward',
      'Delete note',
      { key: 'Delete' },
      act({ kind: 'deleteNote' }),
      hidden,
    ),
    command(
      'editor.deleteBeatMac',
      'Delete beat',
      { key: 'Backspace', shift: true, only: 'mac' },
      act({ kind: 'deleteBeat' }),
      { inPalette: mac },
    ),
    command(
      'editor.deleteBeatWindows',
      'Delete beat',
      { key: 'Delete', shift: true, only: 'other' },
      act({ kind: 'deleteBeat' }),
      { inPalette: !mac },
    ),
    command('editor.editVoice1', 'Edit voice 1', { key: '1', mod: true }, () => {
      entryController(entry)?.setVoice(0);
    }),
    command('editor.editVoice2', 'Edit voice 2', { key: '2', mod: true }, () => {
      entryController(entry)?.setVoice(1);
    }),
    command('editor.toggleInsertMode', 'Toggle insert mode', undefined, () => {
      entry.getState().toggleMode();
    }),
  ];
}
