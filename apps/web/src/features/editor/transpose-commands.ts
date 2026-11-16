import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { commitEdit } from './commit';
import { dialogsOf } from './dialogs';
import { entryController } from './entry-controller';
import type { EffectOutcome } from './effect-commands';
import { planShift, type StringDirection } from './string-shift';
import { planTranspose, type TransposeInput, type TransposeOptions } from './transpose';
import { visibleTracks } from './visible';

export type TransposeCommandId =
  | 'editor.transposeDialog'
  | 'editor.transposeUp'
  | 'editor.transposeDown'
  | 'editor.moveNoteUp'
  | 'editor.moveNoteDown';

type TransposeCommand = Command & { id: TransposeCommandId };

export type TransposeServices = Pick<AppServices, 'document' | 'selection' | 'entry'>;

/** What the transposition acts on now, or undefined with no score open. */
export function transposeInput(services: TransposeServices): TransposeInput | undefined {
  const { score, view } = services.document.getState();
  return (
    score && { score, state: services.selection.getState(), visible: visibleTracks(score, view) }
  );
}

/**
 * Plans and commits a transposition as one undo step, leaving the cursor where it is. A refusal
 * (the pre-check's, or the model's backstop) changes nothing and comes back as the outcome; the
 * dialog shows it in its alert (`quiet`), a key on the status line. What was dropped on the way
 * reads as a notice.
 */
export function applyTranspose(
  services: TransposeServices,
  options: TransposeOptions,
  quiet = false,
): EffectOutcome {
  entryController(services.entry)?.flush();
  const input = transposeInput(services);
  if (!input) return { nothing: true };
  const plan = planTranspose(input, options);
  if ('refused' in plan) return { refused: plan.refused };
  if (!('command' in plan)) return { nothing: true };
  const { document, selection, entry } = services;
  if (!commitEdit({ document, selection, entry }, plan.command, { moveCursor: false })) {
    const refused = entry.getState().message ?? 'That could not be applied';
    if (quiet) entry.getState().setMessage(undefined);
    return { refused };
  }
  if (plan.notice) entry.getState().setMessage(plan.notice, 'notice');
  return { applied: true };
}

/** The semitone keys: the selected notes only, with no chord names or key. Returns whether the score changed. */
export function nudgeNotes(services: TransposeServices, semitones: 1 | -1): boolean {
  const outcome = applyTranspose(services, {
    semitones,
    scope: 'selection',
    chordNames: false,
    keySignature: false,
  });
  if ('refused' in outcome) services.entry.getState().setMessage(outcome.refused);
  else if ('nothing' in outcome) services.entry.getState().setMessage('Select a note first');
  return 'applied' in outcome;
}

/** Moves the selected notes to the neighbouring string; the cursor follows a single note. */
export function moveToString(services: TransposeServices, direction: StringDirection): boolean {
  entryController(services.entry)?.flush();
  const input = transposeInput(services);
  if (!input) return false;
  const plan = planShift(input, direction);
  const { document, selection, entry } = services;
  if ('refused' in plan) {
    entry.getState().setMessage(plan.refused);
    return false;
  }
  if (!commitEdit({ document, selection, entry }, plan.command, { moveCursor: false })) {
    return false;
  }
  const { cursor } = selection.getState();
  if (plan.cursorString !== undefined && cursor) {
    selection.getState().setEdit({ cursor: { ...cursor, string: plan.cursorString } });
  }
  return true;
}

/** Opens the Transpose dialog over the score, or reports why it cannot. */
export function openTransposeDialog(
  services: TransposeServices,
  returnFocus?: HTMLElement | null,
): boolean {
  entryController(services.entry)?.flush();
  const input = transposeInput(services);
  if (!input) {
    services.entry.getState().setMessage('Open a score first');
    return false;
  }
  if (input.score.tracks.every(({ kind }) => kind === 'drums')) {
    services.entry.getState().setMessage('Drum tracks have no pitch to transpose');
    return false;
  }
  services.entry.getState().setMessage(undefined);
  dialogsOf(services).getState().open({ kind: 'transpose' }, returnFocus);
  return true;
}

/**
 * Transposition and string moves, all in the editing context. Guitar Pro 8 has the four keys:
 * Alt+Shift with Up or Down for a semitone, Alt with Up or Down for a string. The dialog has no
 * key, as Guitar Pro has none; the palette opens it.
 */
export function transposeCommands(services: TransposeServices): TransposeCommand[] {
  return [
    {
      id: 'editor.transposeDialog',
      title: 'Transpose…',
      context: 'editing',
      repeat: false,
      run: () => {
        openTransposeDialog(services);
      },
    },
    {
      id: 'editor.transposeUp',
      title: 'Transpose up a semitone',
      shortcut: { key: 'ArrowUp', alt: true, shift: true },
      context: 'editing',
      run: () => {
        nudgeNotes(services, 1);
      },
    },
    {
      id: 'editor.transposeDown',
      title: 'Transpose down a semitone',
      shortcut: { key: 'ArrowDown', alt: true, shift: true },
      context: 'editing',
      run: () => {
        nudgeNotes(services, -1);
      },
    },
    {
      id: 'editor.moveNoteUp',
      title: 'Move to the string above',
      shortcut: { key: 'ArrowUp', alt: true },
      context: 'editing',
      run: () => {
        moveToString(services, 'higher');
      },
    },
    {
      id: 'editor.moveNoteDown',
      title: 'Move to the string below',
      shortcut: { key: 'ArrowDown', alt: true },
      context: 'editing',
      run: () => {
        moveToString(services, 'lower');
      },
    },
  ];
}
