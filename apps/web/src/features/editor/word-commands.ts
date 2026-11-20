import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { commitEdit } from './commit';
import { openWord } from './word-session';
import { beatWithTrack, planWord, type WordKind } from './words';

export type WordCommandId =
  'editor.chordName' | 'editor.beatText' | 'editor.lyrics' | 'editor.removeChordName';

type WordCommand = Command & { id: WordCommandId };

/**
 * The keys that open the word field: A for a chord name and T for beat text, as Guitar Pro has
 * them, and Alt+L for lyrics, which it has no key for. The field's own keys are handled by the
 * field, and a text field keeps its bare keys, so none of these fires while it is open.
 */
export function wordCommands(
  services: Pick<AppServices, 'document' | 'selection' | 'entry' | 'editing' | 'menuTarget'>,
): WordCommand[] {
  const open = (kind: WordKind) => () => {
    openWord(services, kind);
  };
  // The chord name that was right-clicked, else the one on the cursor's beat. Read before anything
  // else, as the host clears the menu target once the command returns.
  const chordBeat = () => {
    const { score } = services.document.getState();
    if (!score || !services.editing.getState().editing) return undefined;
    const target = services.menuTarget.getState().target;
    const id = target?.kind === 'chord' ? target.beat : services.selection.getState().cursor?.beat;
    return id !== undefined && beatWithTrack(score, id)?.beat.chord?.name ? id : undefined;
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
    {
      id: 'editor.removeChordName',
      title: 'Remove chord name',
      context: 'editing',
      inPalette: false,
      enabled: () => chordBeat() !== undefined,
      run: () => {
        const beatId = chordBeat();
        const { score } = services.document.getState();
        const plan = beatId && score && planWord(score, { kind: 'chord', beatId, value: '' });
        if (!plan || 'nothing' in plan || 'refused' in plan) return;
        if (commitEdit(services, plan.command, { moveCursor: false }) && plan.notice) {
          services.entry.getState().setMessage(plan.notice, 'notice');
        }
      },
    },
  ];
}
