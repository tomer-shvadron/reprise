import {
  shiftStrings,
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
  bar: number;
  /** The notes that move: main notes, and grace notes of a beat picked whole. */
  moving: Note[];
}

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
    const created: Beat = { source: beat, track, bar: info.masterBarIndex, moving: [] };
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
    if (found) add(found.beat, found.note);
  }

  const beats = [...byBeat.values()].filter(
    ({ track, moving }) => track.kind === 'fretted' && moving.length > 0,
  );
  if (beats.length === 0) {
    return {
      refused:
        byBeat.size > 0
          ? 'Moving to another string works on fretted tracks only'
          : 'Select a note first',
    };
  }

  const step = direction === 'higher' ? -1 : 1;
  const side = direction === 'higher' ? 'above' : 'below';
  for (const { source, track, bar, moving } of beats) {
    const strings = track.tuning.length;
    const ends = new Map<Note, number>();
    for (const note of moving) {
      const string = note.string + step;
      if (string < 1 || string > strings) {
        return { refused: `There is no string ${side} string ${String(note.string)}` };
      }
      const interval = openPitch(track, note.string) - openPitch(track, string);
      const fret = note.fret + interval;
      if (fret < 0 || fret > track.fretCount) {
        return {
          refused: `Fret ${String(note.fret)} on string ${String(note.string)} would be fret ${String(fret).replace('-', '−')} on string ${String(string)}`,
        };
      }
      if (note.trill) {
        const trill = note.trill.fret + interval;
        if (trill < 0 || trill > track.fretCount) {
          return { refused: `The trill on string ${String(note.string)} would fall off the neck` };
        }
      }
      ends.set(note, string);
    }
    const used = new Set<number>();
    for (const note of source.notes) {
      const string = ends.get(note) ?? note.string;
      if (used.has(string)) {
        return { refused: `String ${String(string)} already has a note in bar ${String(bar + 1)}` };
      }
      used.add(string);
    }
  }

  const selection = {
    beatIds: (target.beatIds ?? []).filter((id) => {
      const beat = byBeat.get(id);
      return beat !== undefined && beats.includes(beat);
    }),
    noteIds: (target.noteIds ?? []).filter((id) => {
      const beat = noteById(id)?.beat;
      return beat !== undefined && beats.includes(beat);
    }),
  };
  const command = shiftStrings(
    {
      ...(selection.beatIds.length > 0 && { beatIds: selection.beatIds }),
      ...(selection.noteIds.length > 0 && { noteIds: selection.noteIds }),
    },
    direction,
  );
  // One note under the cursor and nothing else picked: the key repeats on the same note.
  const own =
    !state.range &&
    !state.selection.noteIds?.length &&
    !state.selection.beatIds?.length &&
    state.cursor?.beat !== undefined &&
    beats.length === 1 &&
    beats[0]?.moving.length === 1;
  return { command, ...(own && state.cursor && { cursorString: state.cursor.string + step }) };
}
