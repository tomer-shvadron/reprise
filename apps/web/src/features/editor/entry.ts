import {
  barTicks,
  beatTicks,
  chain,
  createNote,
  insertBar,
  insertBeat,
  newId,
  removeBeat,
  removeNote,
  setBeatDuration,
  setBeatRest,
  setNote,
  setNoteEffect,
  tieOriginOf,
  type Beat,
  type BeatInput,
  type Command,
  type Id,
  type Score,
  type Track,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { EditCursor, SelectionState } from '@/state/selection';

import { resolveCursor, stopCount, type Resolved } from './cursor';
import { rangeBeats } from './range';
import {
  longer,
  overfullMessage,
  rhythmOf,
  rhythmTicks,
  shorter,
  toggleDot,
  toggleDoubleDot,
  toggleTriplet,
  type Rhythm,
} from './rhythm';
import type { EntryMode } from './entry-store';

export type EntryAction =
  | { kind: 'fret'; fret: number }
  | { kind: 'rest' }
  | { kind: 'tie' }
  | { kind: 'insertAfter' }
  | { kind: 'longer' }
  | { kind: 'shorter' }
  | { kind: 'dot' }
  | { kind: 'doubleDot' }
  | { kind: 'triplet' }
  | { kind: 'deleteNote' }
  | { kind: 'deleteBeat' };

export interface EntryInput {
  score: Score;
  cursor: EditCursor;
  rhythm: Rhythm;
  mode: EntryMode;
  /** The beat insert mode just created, which takes further digits as chord notes. */
  inserted: Id | undefined;
  state: Pick<SelectionState, 'range' | 'selection'>;
  visible?: readonly Id[];
}

/** Where the cursor goes once the command has run: a beat by id, or the first stop of a bar. */
export type Landing = { beat: Id } | { bar: Id };

export interface EditPlan {
  command: Command;
  land?: Landing;
  /** The beat to remember as just inserted; absent forgets it. */
  inserted?: Id;
  /** The note to sound once the edit has been applied. */
  sound?: { track: Id; beat: Id; string: number; fret: number };
}

/**
 * What an entry action does: the model command to apply, or the message to show instead. A
 * plan with only a `rhythm` changes the current rhythm and nothing in the score; `nothing`
 * means there was nothing to do, with no message.
 */
export type EntryPlan = EditPlan | { refused: string } | { rhythm: Rhythm } | { nothing: true };

const EPSILON = 1e-6;

const beatInput = (rhythm: Rhythm): BeatInput => ({
  duration: rhythm.duration,
  dots: rhythm.dots,
  ...(rhythm.tuplet && { tuplet: rhythm.tuplet }),
});

interface Where {
  at: Resolved;
  track: Track;
  beats: readonly Beat[];
  voiceId: Id;
  beat: Beat | undefined;
}

function whereOf(score: Score, cursor: EditCursor): Where | undefined {
  const at = resolveCursor(score, cursor);
  const track = at && score.tracks[at.track];
  const voice = at && track?.bars[at.bar]?.voices[at.voice];
  if (!at || !track || !voice) return undefined;
  return { at, track, beats: voice.beats, voiceId: voice.id, beat: voice.beats[at.stop] };
}

/** Ticks a voice has not used yet in its bar; negative for an over-full bar. */
export function roomLeft(score: Score, track: number, bar: number, voice: number): number {
  const masterBar = score.masterBars[bar];
  const beats = score.tracks[track]?.bars[bar]?.voices[voice]?.beats ?? [];
  if (!masterBar) return 0;
  return barTicks(masterBar) - beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
}

const refuse = (refused: string): EntryPlan => ({ refused });

/**
 * The effect of one entry action at the cursor, as a plan. Pure: nothing here reads a store or
 * a timer, so every key's behaviour is tested against plain scores. A plan that would overfill a
 * bar is refused with the room left, never handed to the model to refuse.
 */
export function planEntry(input: EntryInput, action: EntryAction): EntryPlan {
  const where = whereOf(input.score, input.cursor);
  if (!where) return { nothing: true };
  switch (action.kind) {
    case 'fret':
      return planFret(input, where, action.fret);
    case 'rest':
      return planRest(input, where);
    case 'tie':
      return planTie(input, where);
    case 'insertAfter':
      return planInsertAfter(input, where);
    case 'longer':
      return planRhythm(input, where, longer, 'Already the longest note');
    case 'shorter':
      return planRhythm(input, where, shorter, 'Already the shortest note');
    case 'dot':
      return planRhythm(input, where, toggleDot);
    case 'doubleDot':
      return planRhythm(input, where, toggleDoubleDot);
    case 'triplet':
      return planRhythm(input, where, toggleTriplet);
    case 'deleteNote':
      return planDeleteNote(input, where);
    case 'deleteBeat':
      return planDeleteBeat(where);
  }
}

function guardFretted(where: Where): EntryPlan | undefined {
  return where.track.kind === 'fretted' && where.track.tuning.length > 0
    ? undefined
    : refuse('Note entry works on fretted tracks only');
}

/** Refuses an insertion of `rhythm` into the cursor's bar when it does not fit. */
function noRoom(input: EntryInput, where: Where, rhythm: Rhythm): EntryPlan | undefined {
  const { track, bar, voice } = where.at;
  const room = roomLeft(input.score, track, bar, voice);
  const needed = rhythmTicks(rhythm);
  return needed > room + EPSILON ? refuse(overfullMessage(bar + 1, room, needed)) : undefined;
}

/** Inserts a beat of `rhythm` at `index`, optionally holding a note, landing the cursor on it. */
function insertion(
  input: EntryInput,
  where: Where,
  index: number,
  rhythm: Rhythm,
  note?: { string: number; fret: number; tie?: true },
): EntryPlan {
  const full = noRoom(input, where, rhythm);
  if (full) return full;
  const id = newId();
  const beat: BeatInput = note
    ? { ...beatInput(rhythm), notes: [{ ...createNote(note), id: newId() }] }
    : beatInput(rhythm);
  return {
    command: chain(note ? 'enterNote' : 'enterRest', [
      insertBeat({ voiceId: where.voiceId, index, id }, beat),
    ]),
    land: { beat: id },
    ...(note && { inserted: id, sound: { track: where.track.id, beat: id, ...note } }),
  };
}

function planFret(input: EntryInput, where: Where, fret: number): EntryPlan {
  const refusal = guardFretted(where);
  if (refusal) return refusal;
  const { string } = input.cursor;
  const note = { string, fret };
  const { beat } = where;
  const sound = beat && { track: where.track.id, beat: beat.id, string, fret };
  if (!beat) return insertion(input, where, where.beats.length, input.rhythm, note);
  if (input.mode === 'insert' && input.inserted !== beat.id) {
    return insertion(input, where, where.at.stop, input.rhythm, note);
  }
  return {
    command: chain('enterNote', [setNote({ beatId: beat.id }, note)]),
    ...(input.inserted === beat.id && { inserted: beat.id }),
    ...(sound && { sound }),
  };
}

/** The beats an action on a selection covers: a range, else the picked ones, else the cursor's. */
function targetBeats(input: EntryInput, where: Where) {
  const { score, state } = input;
  const out: { beat: Beat; track: number; bar: number; voice: number }[] = [];
  if (state.range) {
    for (const part of rangeBeats(score, state.range, input.visible)) {
      const track = score.tracks.findIndex(({ id }) => id === part.track);
      for (const beat of part.beats) out.push({ beat, track, bar: part.bar, voice: part.voice });
    }
    if (out.length > 0) return out;
  }
  const { noteIds, beatIds } = state.selection;
  if (noteIds?.length || beatIds?.length) {
    const index = scoreIndex(score);
    const ids = new Set<Id>(beatIds);
    for (const id of noteIds ?? []) {
      const owner = index.noteBeat.get(id);
      if (owner) ids.add(owner);
    }
    for (const id of ids) {
      const info = index.beats.get(id);
      const beat =
        info &&
        score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[
          info.index
        ];
      if (info && beat) {
        out.push({ beat, track: info.trackIndex, bar: info.masterBarIndex, voice: info.voice });
      }
    }
    if (out.length > 0) return out;
  }
  if (where.beat) {
    out.push({ beat: where.beat, track: where.at.track, bar: where.at.bar, voice: where.at.voice });
  }
  return out;
}

function planRest(input: EntryInput, where: Where): EntryPlan {
  const { beat } = where;
  if (!beat || input.mode === 'insert') {
    return insertion(input, where, beat ? where.at.stop : where.beats.length, input.rhythm);
  }
  const played = targetBeats(input, where).filter(({ beat: target }) => !target.rest);
  if (played.length === 0) return { nothing: true };
  return {
    command: chain(
      'enterRest',
      played.map(({ beat: target }) => setBeatRest({ beatId: target.id }, true)),
    ),
  };
}

function planInsertAfter(input: EntryInput, where: Where): EntryPlan {
  const index = where.beat ? where.at.stop + 1 : where.beats.length;
  return insertion(input, where, index, input.rhythm);
}

function planRhythm(
  input: EntryInput,
  where: Where,
  step: (rhythm: Rhythm) => Rhythm | undefined,
  limit?: string,
): EntryPlan {
  const targets = targetBeats(input, where);
  if (targets.length === 0) {
    const next = step(input.rhythm);
    if (next) return { rhythm: next };
    return limit ? refuse(limit) : { nothing: true };
  }
  const changes = targets.flatMap((target) => {
    const next = step(rhythmOf(target.beat));
    return next ? [{ ...target, next }] : [];
  });
  if (changes.length === 0) return limit ? refuse(limit) : { nothing: true };
  // Only a lengthening can overfill, so only a voice that grows is checked: shortening works in
  // a bar that is already over-full, which is the edit that fixes it.
  const voices = new Map<
    string,
    { track: number; bar: number; voice: number; delta: number; needed: number }
  >();
  for (const change of changes) {
    const key = `${String(change.track)}:${String(change.bar)}:${String(change.voice)}`;
    const entry = voices.get(key) ?? { ...change, delta: 0, needed: 0 };
    entry.delta += rhythmTicks(change.next) - beatTicks(change.beat);
    entry.needed = Math.max(entry.needed, rhythmTicks(change.next));
    voices.set(key, entry);
  }
  for (const { track, bar, voice, delta, needed } of voices.values()) {
    const room = roomLeft(input.score, track, bar, voice);
    if (delta > EPSILON && delta > room + EPSILON) {
      return refuse(overfullMessage(bar + 1, room, needed));
    }
  }
  // The model validates after each step, so the beats that shrink run first and pay for the ones
  // that grow; the voice's total then never passes its final size.
  changes.sort(
    (a, b) => rhythmTicks(a.next) - beatTicks(a.beat) - (rhythmTicks(b.next) - beatTicks(b.beat)),
  );
  return {
    command: chain(
      'setRhythm',
      changes.map(({ beat, next }) =>
        setBeatDuration(
          { beatId: beat.id },
          { duration: next.duration, dots: next.dots, tuplet: next.tuplet ?? null },
        ),
      ),
    ),
  };
}

function planTie(input: EntryInput, where: Where): EntryPlan {
  const refusal = guardFretted(where);
  if (refusal) return refusal;
  const { string } = input.cursor;
  const { beat, track, at } = where;
  const existing = beat?.notes.find((note) => note.string === string);
  if (beat && existing?.tie) {
    return {
      command: chain('toggleTie', [setNoteEffect({ noteId: existing.id }, { tie: false })]),
    };
  }
  const origin = tieOriginOf(
    track,
    { bar: at.bar, voice: at.voice, beat: at.stop },
    { string, fret: 0 },
  );
  if (!origin) return refuse(`Nothing to tie to on string ${String(string)}`);
  const note = { string, fret: origin.note.fret, tie: true } as const;
  if (!beat) return insertion(input, where, where.beats.length, input.rhythm, note);
  return {
    command: chain('toggleTie', [setNote({ beatId: beat.id }, note)]),
    sound: { track: track.id, beat: beat.id, string, fret: note.fret },
  };
}

function planDeleteNote(input: EntryInput, where: Where): EntryPlan {
  const picked = input.state.selection.noteIds;
  const ids = picked?.length
    ? [...picked]
    : (() => {
        const note = where.beat?.notes.find(
          (candidate) => candidate.string === input.cursor.string,
        );
        return note ? [note.id] : [];
      })();
  if (ids.length === 0) return refuse(`No note on string ${String(input.cursor.string)} to delete`);
  return {
    command: chain(
      'deleteNote',
      ids.map((noteId) => removeNote({ noteId })),
    ),
  };
}

function planDeleteBeat(where: Where): EntryPlan {
  if (!where.beat) return refuse('No beat here to delete');
  return { command: chain('deleteBeat', [removeBeat({ beatId: where.beat.id })]) };
}

/**
 * Appends a bar after the last one, for → at the end of a full last bar; undefined when the
 * cursor is not at that place. The cursor lands on the new bar's first stop.
 */
export function planAppendBar(score: Score, cursor: EditCursor): EditPlan | undefined {
  const at = resolveCursor(score, cursor);
  if (!at || at.bar !== score.masterBars.length - 1) return undefined;
  if (at.stop < stopCount(score, at.track, at.bar, at.voice) - 1) return undefined;
  // A full bar has no end slot, so a cursor on one is on a beat; an end slot is not a full bar.
  if (cursor.beat === undefined) return undefined;
  const id = newId();
  return {
    command: chain('appendBar', [insertBar({ index: score.masterBars.length, id })]),
    land: { bar: id },
  };
}
