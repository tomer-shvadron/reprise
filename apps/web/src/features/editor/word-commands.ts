import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { openWord } from './word-session';
import type { WordKind } from './words';

export type WordCommandId = 'editor.chordName' | 'editor.beatText' | 'editor.lyrics';

type WordCommand = Command & { id: WordCommandId };

/**
 * The keys that open the word field: A for a chord name and T for beat text, as Guitar Pro has
 * them, and Alt+L for lyrics, which it has no key for. The field's own keys are handled by the
 * field, and a text field keeps its bare keys, so none of these fires while it is open.
 */
export function wordCommands(
  services: Pick<AppServices, 'document' | 'selection' | 'entry' | 'editing'>,
): WordCommand[] {
  const open = (kind: WordKind) => () => {
    openWord(services, kind);
  };
  return [
    {
      id: 'editor.chordName',
      title: 'Chord name',
      shortcut: { key: 'a' },
      context: 'editing',
      repeat: false,
      run: open('chord'),
    },
    {
      id: 'editor.beatText',
      title: 'Beat text',
      shortcut: { key: 't' },
      context: 'editing',
      repeat: false,
      run: open('text'),
    },
    {
      id: 'editor.lyrics',
      title: 'Lyrics',
      shortcut: { key: 'l', alt: true },
      context: 'editing',
      repeat: false,
      run: open('lyric'),
    },
  ];
}
