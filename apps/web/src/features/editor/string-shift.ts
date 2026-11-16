import {
  shiftStrings,
  tieChainOf,
  tieOriginOf,
  type Beat as ScoreBeat,
  type Command,
  type Id,
  type Note,
  type Score,
  type Track,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { SelectionState } from '@/state/selection';

import { editTarget } from './range';

export type StringDirection = 'higher' | 'lower';

export interface StringShiftInput {
  score: Score;
  state: Pick<SelectionState, 'cursor' | 'range' | 'selection'>;
  visible?: readonly Id[];
}

export type StringShiftPlan =
  | {
      command: Command;
      /** The string the cursor goes to, when the move was of the note under it. */
      cursorString?: number;
    }
  | { refused: string };

interface Beat {
  source: ScoreBeat;
  track: Track;
  id: Id;
  bar: number;
  voice: number;
  index: number;
  /** The notes that move: main notes, and grace notes of a beat picked whole. */
  moving: Note[];
}

const GRACE_PICK = 'Grace notes move with their beat: select the beat';

/** The open string's pitch; the tuning lists the lowest string first. */
const openPitch = (track: Track, string: number): number =>
  track.tuning[track.tuning.length - string] ?? 0;

/**
 * Plans "move to the string above or below" for what the cursor, range or picked notes select.
 * Only fretted tracks move; the rest are left out and refuse when nothing is left. The model's
 * own refusals (no such string, a fret off the neck, an occupied string) are found first and
 * worded with the bar. When the target was the note under the cursor, the cursor follows it.
 */
export function planShift(input: StringShiftInput, direction: StringDirection): StringShiftPlan {
  const { score, state } = input;
  const target = editTarget(score, state, input.visible);
  const index = scoreIndex(score);
  const byBeat = new Map<Id, Beat>();
  const entry = (id: Id): Beat | undefined => {
    const known = byBeat.get(id);
    if (known) return known;
    const info = index.beats.get(id);
    if (!info) return undefined;
    const track = score.tracks[info.trackIndex];
    const beat = track?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
    if (!track || !beat) return undefined;
    const created: Beat = {
      source: beat,
      track,
      id,
      bar: info.masterBarIndex,
      voice: info.voice,
      index: info.index,
      moving: [],
    };
    byBeat.set(id, created);
    return created;
  };
  const noteById = (id: Id): { note: Note; beat: Beat } | undefined => {
    const owner = index.noteBeat.get(id);
    const beat = owner === undefined ? undefined : entry(owner);
    const note =
      beat?.source.notes.find((n) => n.id === id) ??
      beat?.source.grace?.flatMap((g) => g.notes).find((n) => n.id === id);
    return beat && note ? { note, beat } : undefined;
  };
  const add = (beat: Beat, note: Note): void => {
    if (!beat.moving.includes(note)) beat.moving.push(note);
  };
  for (const id of target.beatIds ?? []) {
    const beat = entry(id);
    if (!beat) continue;
    for (const note of beat.source.notes) add(beat, note);
    for (const grace of beat.source.grace ?? []) for (const note of grace.notes) add(beat, note);
  }
  for (const id of target.noteIds ?? []) {
    const found = noteById(id);
    // The model finds a picked note only among a beat's main notes.
    if (found && !found.beat.source.notes.includes(found.note)) {
      return { refused: GRACE_PICK };
    }
    if (found) add(found.beat, found.note);
  }

  const fretted = (beat: Beat) => beat.track.kind === 'fretted';
  if (![...byBeat.values()].some((beat) => fretted(beat) && beat.moving.length > 0)) {
    return {
      refused:
        byBeat.size > 0
          ? 'Moving to another string works on fretted tracks only'
          : 'Select a note first',
    };
  }

  // A tie moves as a whole: the notes tied to a moved note follow it, in their own bars.
  for (const beat of [...byBeat.values()]) {
    if (!fretted(beat)) continue;
    for (const note of beat.moving.filter((n) => beat.source.notes.includes(n))) {
      const at = { bar: beat.bar, voice: beat.voice, beat: beat.index };
      for (const link of tieChainOf(beat.track, at, note)) {
        const followed = beat.track.bars[link.bar]?.voices[beat.voice]?.beats[link.beat];
        const owner = followed && entry(followed.id);
        if (owner) add(owner, link.note);
      }
    }
  }
  const everyMoving = new Set([...byBeat.values()].filter(fretted).flatMap(({ moving }) => moving));
  const beats = [...byBeat.values()].filter((beat) => fretted(beat) && beat.moving.length > 0);

  const step = direction === 'higher' ? -1 : 1;
  const side = direction === 'higher' ? 'above' : 'below';
  const ends = new Map<Note, number>();
  for (const { source, track, bar, voice, index: at, moving } of beats) {
    const strings = track.tuning.length;
    const where = `in bar ${String(bar + 1)}`;
    for (const note of moving) {
      const string = note.string + step;
      if (string < 1 || string > strings) {
        return { refused: `There is no string ${side} string ${String(note.string)} ${where}` };
      }
      const interval = openPitch(track, note.string) - openPitch(track, string);
      const fret = note.fret + interval;
      if (fret < 0 || fret > track.fretCount) {
        return {
          refused: `Fret ${String(note.fret)} on string ${String(note.string)} would be fret ${String(fret).replace('-', '−')} on string ${String(string)} ${where}`,
        };
      }
      if (note.trill) {
        const trill = note.trill.fret + interval;
        if (trill < 0 || trill > track.fretCount) {
          return {
            refused: `The trill on string ${String(note.string)} would fall off the neck ${where}`,
          };
        }
      }
      if (note.tie && source.notes.includes(note)) {
        const origin = tieOriginOf(track, { bar, voice, beat: at }, note);
        if (origin && !everyMoving.has(origin.note)) {
          return {
            refused: `The note on string ${String(note.string)} ${where} is tied to an earlier note: select the whole tie`,
          };
        }
      }
      ends.set(note, string);
    }
    const used = new Set<number>();
    for (const note of source.notes) {
      const string = ends.get(note) ?? note.string;
      if (used.has(string)) {
        return { refused: `String ${String(string)} already has a note ${where}` };
      }
      used.add(string);
    }
  }

  // Beats named by the target carry all their notes; the rest (picked notes, tied followers) go by id.
  const whole = new Set((target.beatIds ?? []).filter((id) => byBeat.has(id)));
  const beatIds = [...whole].filter((id) => {
    const beat = byBeat.get(id);
    return beat !== undefined && beats.includes(beat);
  });
  const noteIds = beats
    .filter(({ id }) => !whole.has(id))
    .flatMap(({ moving }) => moving.map(({ id }) => id));
  const command = shiftStrings(
    {
      ...(beatIds.length > 0 && { beatIds }),
      ...(noteIds.length > 0 && { noteIds }),
    },
    direction,
  );
  // Only the note under the cursor itself: the cursor goes where the note goes, so the key repeats.
  const only =
    target.noteIds?.length === 1 && !target.beatIds?.length ? target.noteIds[0] : undefined;
  const own =
    only !== undefined &&
    !state.range &&
    !state.selection.noteIds?.length &&
    !state.selection.beatIds?.length &&
    state.cursor?.beat !== undefined
      ? noteById(only)?.note
      : undefined;
  const cursorString = own && ends.get(own);
  return { command, ...(cursorString !== undefined && { cursorString }) };
}
