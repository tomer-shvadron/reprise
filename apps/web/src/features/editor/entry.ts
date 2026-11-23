import {
  barTicks,
  beatTicks,
  chain,
  createNote,
  insertBar,
  insertBeat,
  newId,
  percussionInstrument,
  removeBeat,
  removeNote,
  setBeatDurations,
  setBeatRest,
  setNote,
  setNoteEffect,
  storedFret,
  tieOriginOf,
  type Beat,
  type BeatInput,
  type Command,
  type Id,
  type KeySignature,
  type Letter,
  type Note,
  type Score,
  type Track,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { EditCursor, SelectionState } from '@/state/selection';

import { resolveCursor, stopCount, type Resolved } from './cursor';
import { cursorLane, LAST_DRUM_KEY, laneLabel, noteAtCursor } from './drum-lanes';
import { chordPitch, clefOf, letterPitch, middleLine, pitchName } from './pitch-entry';
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
  /** A hit on the cursor's lane, typed as 0 on a drum track. */
  | { kind: 'lane' }
  /** A note typed by letter on a pitched track; `chord` adds it to the beat instead of replacing the lane's. */
  | { kind: 'pitch'; letter: Letter; chord: boolean }
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
  /** The lane the cursor lands on: a GM key on drums, a MIDI key on a pitched track. */
  lane?: number;
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
  /** The bar's key signature, which spells and picks letters on a pitched track. */
  key: KeySignature;
}

const C_MAJOR: KeySignature = { fifths: 0, minor: false };

function whereOf(score: Score, cursor: EditCursor): Where | undefined {
  const at = resolveCursor(score, cursor);
  const track = at && score.tracks[at.track];
  const voice = at && track?.bars[at.bar]?.voices[at.voice];
  if (!at || !track || !voice) return undefined;
  return {
    at,
    track,
    beats: voice.beats,
    voiceId: voice.id,
    beat: voice.beats[at.stop],
    key: score.masterBars[at.bar]?.keySignature ?? C_MAJOR,
  };
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
    case 'lane':
      return where.track.kind === 'fretted'
        ? refuse('A note on the lane is placed on a drum or keyboard track only')
        : planFret(input, where, laneOf(where, input.cursor));
    case 'pitch':
      return planPitch(input, where, action.letter, action.chord);
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

/** The lane of the cursor on a track that has one: its key, else where the track's cursor starts. */
function laneOf(where: Where, cursor: EditCursor): number {
  if (where.track.kind === 'drums') return cursorLane(cursor);
  const { track, at } = where;
  return cursor.pitch ?? middleLine(clefOf(track, at.bar), track.display.octaveShift);
}

/** "Acoustic Snare (38)" on drums, "F♯4" on a pitched track. */
function laneName(where: Where, lane: number): string {
  return where.track.kind === 'drums' ? laneLabel(lane) : pitchName(lane, where.key);
}

/** Fretted tracks with strings, drum tracks and pitched tracks take notes. */
function guardNotes(where: Where): EntryPlan | undefined {
  const { track } = where;
  return track.kind === 'fretted' && track.tuning.length === 0
    ? refuse('Note entry works on tracks with strings, drums or keys only')
    : undefined;
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
  lane?: number,
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
    ...(lane !== undefined && { lane }),
    ...(note && { inserted: id, sound: { track: where.track.id, beat: id, ...note } }),
  };
}

/** Typed frets are the ones the tab shows; the model keeps the drone string's from its own nut. */
function planFret(input: EntryInput, where: Where, written: number): EntryPlan {
  const refusal = guardNotes(where);
  if (refusal) return refusal;
  if (where.track.kind === 'drums') return planHit(input, where, written);
  if (where.track.kind === 'pitched') {
    // 0 is the lane's own pitch, as it is the drum's; every other digit means nothing here.
    return written === 0
      ? planKey(input, where, laneOf(where, input.cursor), 'add')
      : refuse('Type a note name, A to G');
  }
  const { string } = input.cursor;
  const fret = storedFret(where.track, string, written);
  if (fret === undefined) {
    const first = (where.track.drone?.fret ?? 0) + 1;
    return refuse(
      `String ${String(string)} has no frets 1 to ${String(first - 1)}: type 0, or ${String(first)} and up`,
    );
  }
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

/** A drum hit: the typed number is the GM key, kept as the note's `fret` on string 0. */
function planHit(input: EntryInput, where: Where, key: number): EntryPlan {
  if (!percussionInstrument(key)) {
    return refuse(`No drum sound on key ${String(key)}: drums are 27 to ${String(LAST_DRUM_KEY)}`);
  }
  const note = { string: 0, fret: key };
  const { beat } = where;
  if (!beat) return insertion(input, where, where.beats.length, input.rhythm, note, key);
  if (input.mode === 'insert' && input.inserted !== beat.id) {
    return insertion(input, where, where.at.stop, input.rhythm, note, key);
  }
  return {
    command: chain('enterNote', [setNote({ beatId: beat.id }, note)]),
    lane: key,
    ...(input.inserted === beat.id && { inserted: beat.id }),
    sound: { track: where.track.id, beat: beat.id, ...note },
  };
}

/** The beat the new note goes on is a fresh one, not the beat under the cursor. */
const startsBeat = (input: EntryInput, where: Where): boolean =>
  !where.beat || (input.mode === 'insert' && input.inserted !== where.beat.id);

/**
 * The key a note's letter sounds at: the nearest octave to the note before the cursor in this
 * voice, else to the clef's middle line; or, for a chord note, the first above the beat's highest.
 */
function keyForLetter(
  input: EntryInput,
  where: Where,
  letter: Letter,
  chord: boolean,
): number | undefined {
  const { beat } = where;
  if (chord && beat && beat.notes.length > 0 && !startsBeat(input, where)) {
    return chordPitch(letter, Math.max(...beat.notes.map(({ fret }) => fret)), where.key);
  }
  return letterPitch(letter, referenceKey(where), where.key);
}

/** The top key of the nearest earlier played beat of this voice, across bars; else the middle line. */
function referenceKey(where: Where): number {
  const { track, at } = where;
  for (let bar = at.bar; bar >= 0; bar -= 1) {
    const beats = track.bars[bar]?.voices[at.voice]?.beats ?? [];
    for (let i = bar === at.bar ? at.stop - 1 : beats.length - 1; i >= 0; i -= 1) {
      const notes = beats[i]?.notes ?? [];
      if (notes.length > 0) return Math.max(...notes.map(({ fret }) => fret));
    }
  }
  return middleLine(clefOf(track, at.bar), track.display.octaveShift);
}

/** A letter typed on a pitched track, A to G, or ⇧A to ⇧G to add to the chord. */
function planPitch(input: EntryInput, where: Where, letter: Letter, chord: boolean): EntryPlan {
  if (where.track.kind !== 'pitched') {
    return refuse('Typing a note name works on keyboard tracks only');
  }
  const midi = keyForLetter(input, where, letter, chord);
  if (midi === undefined) return refuse(`No ${letter} in the range of the keys`);
  return planKey(input, where, midi, chord ? 'add' : 'replace');
}

/**
 * A pitched note at `midi`, held as `fret` on string 0. `replace`, in overwrite mode, swaps the
 * note in the cursor's lane for it in one chain, keeping what the note had but its tie and
 * accidental; with no note in the lane it adds one. `add` only adds, which is a chord note.
 */
function planKey(input: EntryInput, where: Where, midi: number, how: 'replace' | 'add'): EntryPlan {
  const note = { string: 0, fret: midi };
  const { beat } = where;
  if (!beat) return insertion(input, where, where.beats.length, input.rhythm, note, midi);
  if (startsBeat(input, where)) {
    return insertion(input, where, where.at.stop, input.rhythm, note, midi);
  }
  const justInserted = input.inserted === beat.id;
  const old = how === 'replace' && !justInserted ? noteInSlot(where, input.cursor) : undefined;
  const sound = { track: where.track.id, beat: beat.id, ...note };
  if (!old || old.fret === midi) {
    return {
      command: chain('enterNote', [setNote({ beatId: beat.id }, note)]),
      lane: midi,
      ...(justInserted && { inserted: beat.id }),
      sound,
    };
  }
  const kept: Partial<Note> = { ...old };
  delete kept.id;
  delete kept.accidental;
  return {
    command: chain('enterNote', [
      removeNote({ noteId: old.id }),
      setNote({ beatId: beat.id, id: old.id }, { ...kept, ...note, tie: false }),
    ]),
    lane: midi,
    sound,
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
  // One batched command: one history step, and the model checks only the end state, so no
  // shrink-first ordering is needed.
  return {
    command: chain('setRhythm', [
      setBeatDurations(
        changes.map(({ beat, next }) => ({
          beatId: beat.id,
          rhythm: { duration: next.duration, dots: next.dots, tuplet: next.tuplet ?? null },
        })),
      ),
    ]),
  };
}

const noteInSlot = (where: Where, cursor: EditCursor) =>
  where.beat &&
  noteAtCursor(
    where.track,
    where.beat.notes,
    where.track.kind === 'pitched' ? { ...cursor, pitch: laneOf(where, cursor) } : cursor,
  );

function planTie(input: EntryInput, where: Where): EntryPlan {
  const refusal = guardNotes(where);
  if (refusal) return refusal;
  const onLane = where.track.kind !== 'fretted';
  const string = onLane ? 0 : input.cursor.string;
  const lane = onLane ? laneOf(where, input.cursor) : undefined;
  const { beat, track, at } = where;
  const existing = noteInSlot(where, input.cursor);
  if (beat && existing?.tie) {
    return {
      command: chain('toggleTie', [setNoteEffect({ noteId: existing.id }, { tie: false })]),
    };
  }
  const origin = tieOriginOf(
    track,
    { bar: at.bar, voice: at.voice, beat: at.stop },
    { string, fret: lane ?? 0 },
  );
  if (!origin) {
    return refuse(
      lane === undefined
        ? `Nothing to tie to on string ${String(string)}`
        : `Nothing to tie to on ${laneName(where, lane)}`,
    );
  }
  const note = { string, fret: origin.note.fret, tie: true } as const;
  if (!beat) return insertion(input, where, where.beats.length, input.rhythm, note, lane);
  return {
    command: chain('toggleTie', [setNote({ beatId: beat.id }, note)]),
    ...(lane !== undefined && { lane }),
    sound: { track: track.id, beat: beat.id, string, fret: note.fret },
  };
}

function planDeleteNote(input: EntryInput, where: Where): EntryPlan {
  const picked = input.state.selection.noteIds;
  const ids = picked?.length
    ? [...picked]
    : (() => {
        const note = noteInSlot(where, input.cursor);
        return note ? [note.id] : [];
      })();
  if (ids.length === 0) {
    if (where.track.kind === 'fretted') {
      return refuse(`No note on string ${String(input.cursor.string)} to delete`);
    }
    const lane = laneOf(where, input.cursor);
    return refuse(
      where.track.kind === 'drums'
        ? `No ${percussionInstrument(lane)?.name ?? 'hit'} on this beat`
        : `No ${pitchName(lane, where.key)} on this beat`,
    );
  }
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
