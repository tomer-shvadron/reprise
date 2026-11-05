import type { Beat } from '../beat';
import { createNote } from '../factories';
import type { Command } from '../history';
import { newId } from '../id';
import type { Id } from '../id';
import { NoteSchema } from '../note';
import type { Note } from '../note';
import type { Score } from '../score';
import type { Track } from '../track';
import { assignChanges } from './changes';
import type { Changes } from './changes';
import { assertFreshId, hasTieTarget, parseOrThrow, previousBeat, releaseTies } from './checks';
import { CommandError } from './command-error';
import { at, beatAt, findBeat, findBeats, findNotes } from './locate';
import type { BeatAt } from './locate';

export type NoteInput = Pick<Note, 'string' | 'fret'> &
  Partial<Omit<Note, 'id' | 'string' | 'fret'>>;

/** Every note field except identity and placement. */
export type NoteEffects = Omit<Note, 'id' | 'string' | 'fret'>;

/** Notes picked directly, plus every note (grace notes included) of the beats picked. */
export interface Selection {
  beatIds?: readonly Id[];
  noteIds?: readonly Id[];
}

/** The highest fret reachable above the capo; frets count from the capo, as Guitar Pro shows them. */
function maxFret(track: Track): number {
  return Math.max(0, track.fretCount - track.capo);
}

function assertPlacement(track: Track, note: Pick<Note, 'string' | 'fret'>, command: string): void {
  if (track.kind !== 'fretted') {
    if (note.string !== 0) {
      throw new CommandError(
        command,
        'invalid-value',
        `notes on a ${track.kind} track use string 0`,
      );
    }
    return;
  }
  const strings = track.tuning.length;
  if (note.string < 1 || note.string > strings) {
    throw new CommandError(
      command,
      'invalid-value',
      `string ${String(note.string)} is outside 1 to ${String(strings)}`,
    );
  }
  if (note.fret < 0 || note.fret > maxFret(track)) {
    throw new CommandError(
      command,
      'off-fretboard',
      `fret ${String(note.fret)} is outside 0 to ${String(maxFret(track))}`,
    );
  }
}

function assertTie(track: Track, position: BeatAt, note: Note, command: string): void {
  const previous = previousBeat(track, position.bar, position.voice, position.beat);
  if (note.tie && !hasTieTarget(track, note, previous)) {
    throw new CommandError(command, 'tie-target', 'the tied note has nothing to tie to');
  }
}

/**
 * Places a note on a beat: on fretted tracks it replaces the note on the same string, elsewhere
 * the note with the same MIDI value; otherwise it adds one. A rest becomes a played beat.
 */
export function setNote(target: { beatId: Id; id?: Id }, note: NoteInput): Command {
  const name = 'setNote';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      const track = at(draft.tracks, position.track, name);
      const beat = beatAt(draft, position, name);
      assertPlacement(track, note, name);
      const existing = beat.notes.find((n) =>
        track.kind === 'fretted' ? n.string === note.string : n.fret === note.fret,
      );
      let placed: Note;
      if (existing) {
        Object.assign(existing, note);
        placed = existing;
      } else {
        if (target.id !== undefined) assertFreshId(draft, target.id, name);
        placed = { ...createNote(note), id: target.id ?? newId() };
        beat.notes.push(placed);
      }
      beat.rest = false;
      parseOrThrow(NoteSchema, existing ?? placed, name);
      assertTie(track, position, placed, name);
    },
  };
}

/** Removes a note; a beat left without notes becomes a rest, as in Guitar Pro. */
export function removeNote(target: { noteId: Id }): Command {
  const name = 'removeNote';
  return {
    name,
    run(draft) {
      const [found] = findNotes(draft, [target.noteId], name);
      if (!found) throw new CommandError(name, 'not-found', `no note ${target.noteId}`);
      const track = at(draft.tracks, found.track, name);
      const beat = beatAt(draft, found, name);
      beat.notes.splice(found.note, 1);
      if (beat.notes.length === 0) beat.rest = true;
      releaseTies(track, found.bar, found.voice, found.beat + 1);
    },
  };
}

export function setNoteEffect(target: { noteId: Id }, effects: Changes<NoteEffects>): Command {
  const name = 'setNoteEffect';
  return {
    name,
    run(draft) {
      const [found] = findNotes(draft, [target.noteId], name);
      if (!found) throw new CommandError(name, 'not-found', `no note ${target.noteId}`);
      const track = at(draft.tracks, found.track, name);
      const note = at(beatAt(draft, found, name).notes, found.note, name);
      assignChanges(note, effects);
      parseOrThrow(NoteSchema, note, name);
      assertTie(track, found, note, name);
    },
  };
}

interface Selected {
  track: Track;
  position: BeatAt;
  beat: Beat;
  notes: Note[];
}

/** Groups the selection by beat, each note once, main notes before grace notes. */
function select(draft: Score, selection: Selection, command: string): Selected[] {
  const byBeat = new Map<string, Selected>();
  const seen = new Set<Id>();
  const entry = (position: BeatAt): Selected => {
    const key = `${String(position.track)}/${String(position.bar)}/${String(position.voice)}/${String(position.beat)}`;
    let selected = byBeat.get(key);
    if (!selected) {
      const track = at(draft.tracks, position.track, command);
      selected = { track, position, beat: beatAt(draft, position, command), notes: [] };
      byBeat.set(key, selected);
    }
    return selected;
  };
  const add = (selected: Selected, note: Note): void => {
    if (seen.has(note.id)) return;
    seen.add(note.id);
    selected.notes.push(note);
  };
  for (const position of findBeats(draft, selection.beatIds ?? [], command)) {
    const selected = entry(position);
    for (const note of selected.beat.notes) add(selected, note);
    for (const grace of selected.beat.grace ?? [])
      for (const note of grace.notes) add(selected, note);
  }
  for (const position of findNotes(draft, selection.noteIds ?? [], command)) {
    const selected = entry(position);
    add(selected, at(selected.beat.notes, position.note, command));
  }
  return [...byBeat.values()];
}

/**
 * Shifts every selected note by `semitones`: the fret on fretted tracks, staying on its string
 * and within the fretboard; the MIDI value on pitched tracks. Drum notes name instruments, and
 * dead notes have no pitch, so both stay. Explicit accidentals are dropped for re-spelling.
 */
export function transposeSelection(selection: Selection, semitones: number): Command {
  const name = 'transposeSelection';
  return {
    name,
    run(draft) {
      if (!Number.isInteger(semitones)) {
        throw new CommandError(name, 'invalid-value', 'semitones must be a whole number');
      }
      for (const { track, notes } of select(draft, selection, name)) {
        if (track.kind === 'drums') continue;
        const highest = track.kind === 'fretted' ? maxFret(track) : 127;
        const shift = (fret: number): number => {
          const shifted = fret + semitones;
          if (shifted < 0 || shifted > highest) {
            throw new CommandError(
              name,
              'off-fretboard',
              `fret ${String(fret)} shifted by ${String(semitones)} falls outside 0 to ${String(highest)}`,
            );
          }
          return shifted;
        };
        for (const note of notes) {
          if (note.dead) continue;
          note.fret = shift(note.fret);
          if (note.trill) note.trill.fret = shift(note.trill.fret);
          delete note.accidental;
        }
      }
    },
  };
}

/**
 * Moves each selected note to the neighbouring string, re-fretted to keep its pitch: `higher` is
 * the higher-pitched string (string number minus one). Ties broken by the move are released.
 */
export function shiftStrings(selection: Selection, direction: 'higher' | 'lower'): Command {
  const name = 'shiftStrings';
  const step = direction === 'higher' ? -1 : 1;
  return {
    name,
    run(draft) {
      const selected = select(draft, selection, name);
      for (const { track, beat, notes } of selected) {
        if (track.kind !== 'fretted') {
          throw new CommandError(name, 'not-fretted', `a ${track.kind} track has no strings`);
        }
        const strings = track.tuning.length;
        const open = (string: number): number => track.tuning[strings - string] ?? 0;
        for (const note of notes) {
          const string = note.string + step;
          if (string < 1 || string > strings) {
            throw new CommandError(
              name,
              'invalid-value',
              `string ${String(note.string)} has no neighbour ${direction}`,
            );
          }
          const interval = open(note.string) - open(string);
          const fret = note.fret + interval;
          if (fret < 0 || fret > maxFret(track)) {
            throw new CommandError(
              name,
              'off-fretboard',
              `fret ${String(note.fret)} on string ${String(note.string)} becomes fret ${String(fret)} on string ${String(string)}`,
            );
          }
          const trill = note.trill ? note.trill.fret + interval : 0;
          if (trill < 0 || trill > maxFret(track)) {
            throw new CommandError(
              name,
              'off-fretboard',
              `the trill fret falls off string ${String(string)}`,
            );
          }
          note.string = string;
          note.fret = fret;
          if (note.trill) note.trill.fret = trill;
        }
        const used = new Set<number>();
        for (const note of beat.notes) {
          if (used.has(note.string)) {
            throw new CommandError(
              name,
              'string-occupied',
              `two notes on string ${String(note.string)}`,
            );
          }
          used.add(note.string);
        }
      }
      for (const { track, position } of selected) {
        releaseTies(track, position.bar, position.voice, position.beat);
        releaseTies(track, position.bar, position.voice, position.beat + 1);
      }
    },
  };
}
