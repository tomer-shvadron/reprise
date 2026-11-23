import {
  chain,
  respell,
  setNoteEffects,
  tieChainOf,
  type Command,
  type Id,
  type Note,
  type NoteEffectEdit,
  type Score,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { SelectionState } from '@/state/selection';

import { editTarget } from './range';

export interface RespellInput {
  score: Score;
  state: Pick<SelectionState, 'cursor' | 'range' | 'selection'>;
  visible?: readonly Id[];
}

export type RespellPlan = { command: Command } | { refused: string };

const C_MAJOR = { fifths: 0, minor: false } as const;

/**
 * Flips the enharmonic spelling of the notes the cursor, range or picked notes cover (a note under
 * the cursor, else the beat's): B♭ to A♯ and back, through the model's `respell`. Only the stored
 * accidental changes, in one step; a drum note has no spelling and is left out.
 */
export function planRespell(input: RespellInput): RespellPlan {
  const { score, state } = input;
  const target = editTarget(score, state, input.visible);
  const index = scoreIndex(score);
  const picked = new Map<Id, { note: Note; track: number; bar: number }>();
  const add = (note: Note, track: number, bar: number) => picked.set(note.id, { note, track, bar });
  const beatAt = (id: Id) => {
    const info = index.beats.get(id);
    if (!info) return undefined;
    const beat =
      score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[
        info.index
      ];
    return beat && { info, beat };
  };
  for (const id of target.beatIds ?? []) {
    const found = beatAt(id);
    if (!found) continue;
    for (const note of found.beat.notes)
      add(note, found.info.trackIndex, found.info.masterBarIndex);
  }
  for (const id of target.noteIds ?? []) {
    const owner = index.noteBeat.get(id);
    const found = owner === undefined ? undefined : beatAt(owner);
    const note = found?.beat.notes.find((n) => n.id === id);
    if (found && note) add(note, found.info.trackIndex, found.info.masterBarIndex);
  }
  // A tied note's continuations are spelled with it, as transpose moves them: layout draws each
  // from its own accidental, so a chain left half-respelled would join two staff positions.
  const chains = new Map<Id, Note[]>();
  const followers = new Set<Id>();
  for (const [id, { note, track, bar }] of picked) {
    const owner = score.tracks[track];
    const info = index.noteBeat.get(id);
    const at = info === undefined ? undefined : index.beats.get(info);
    if (!owner || !at) continue;
    const links = tieChainOf(owner, { bar, voice: at.voice, beat: at.index }, note);
    chains.set(
      id,
      links.map((link) => link.note),
    );
    for (const link of links) followers.add(link.note.id);
  }
  const edits = new Map<Id, NoteEffectEdit>();
  for (const { note, track, bar } of picked.values()) {
    const owner = score.tracks[track];
    // A picked continuation follows its picked origin instead of flipping on its own.
    if (!owner || owner.kind === 'drums' || followers.has(note.id)) continue;
    const flipped = respell(owner, note, score.masterBars[bar]?.keySignature ?? C_MAJOR);
    if (flipped.accidental === note.accidental) continue;
    for (const target of [note, ...(chains.get(note.id) ?? [])]) {
      edits.set(target.id, {
        noteId: target.id,
        effects: { accidental: flipped.accidental ?? null },
      });
    }
  }
  if (edits.size > 0) return { command: chain('respell', [setNoteEffects([...edits.values()])]) };
  return { refused: picked.size > 0 ? 'Drum notes have no spelling' : 'Select a note first' };
}
