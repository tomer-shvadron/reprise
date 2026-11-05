import type { Note } from './note';
import type { Track } from './track';

export const MIDI_MAX = 127;

type PitchTrack = Pick<Track, 'kind' | 'tuning' | 'capo'>;
type FretTrack = Pick<Track, 'kind' | 'tuning' | 'capo' | 'fretCount'>;

/** The MIDI note of an open string, without the capo; `undefined` when the track has no such string. */
export function openStringPitch(track: Pick<Track, 'tuning'>, string: number): number | undefined {
  if (!Number.isInteger(string) || string < 1) return undefined;
  return track.tuning[track.tuning.length - string];
}

/**
 * The sounding MIDI note. Frets count from the capo, as Guitar Pro writes them. Throws on a
 * fretted note whose string the track does not have, which `validateScore` reports as
 * `string-range`.
 */
export function midiNote(track: PitchTrack, note: Pick<Note, 'string' | 'fret'>): number {
  if (track.kind !== 'fretted') return note.fret;
  const open = openStringPitch(track, note.string);
  if (open === undefined) {
    throw new RangeError(
      `String ${String(note.string)} is outside a ${String(track.tuning.length)}-string tuning`,
    );
  }
  return open + track.capo + note.fret;
}

export interface FretPosition {
  string: number;
  fret: number;
}

export type TransposeFailure = 'belowOpenString' | 'aboveLastFret' | 'outOfMidiRange';

/** A natural harmonic's node no longer matches its fret; `harmonic.value` is left to the editor. */
export type TransposeWarning = 'natural-harmonic-moved';

export type TransposeResult =
  | {
      ok: true;
      note: Note;
      /** The trill's alternate fret fell off the fretboard, so the trill was removed. */
      trillDropped: boolean;
      warnings: TransposeWarning[];
    }
  | {
      ok: false;
      reason: TransposeFailure;
      /** The MIDI note the transposition asked for. */
      midi: number;
      /** Other strings that can play `midi`, string 1 first; empty on pitched tracks. */
      alternatives: FretPosition[];
    };

function failureAt(track: FretTrack, string: number, fret: number): TransposeFailure | undefined {
  if (track.kind !== 'fretted') return fret < 0 || fret > MIDI_MAX ? 'outOfMidiRange' : undefined;
  if (fret < 0) return 'belowOpenString';
  if (fret > track.fretCount - track.capo) return 'aboveLastFret';
  return midiNote(track, { string, fret }) > MIDI_MAX ? 'outOfMidiRange' : undefined;
}

function alternativePositions(track: FretTrack, midi: number, except: number): FretPosition[] {
  const positions: FretPosition[] = [];
  for (let string = 1; string <= track.tuning.length; string++) {
    const open = openStringPitch(track, string);
    if (string === except || open === undefined) continue;
    const fret = midi - open - track.capo;
    if (failureAt(track, string, fret) === undefined) positions.push({ string, fret });
  }
  return positions;
}

/**
 * Moves a note by `semitones` on its own string, keeping every other property, the trill's
 * alternate fret included. Drum notes come back unchanged, since their value names an
 * instrument; they and a move by zero return the input object, not a copy. A stored
 * `accidental` survives only octave shifts. A natural harmonic keeps its `value` and the result
 * warns, since its node is a place on the string; an artificial harmonic's `value` is an offset
 * and travels with the note. Never throws for a note that falls off the fretboard or out of
 * MIDI range: the failure says why and, on fretted tracks, where else the pitch can be played.
 */
export function transpose(note: Note, semitones: number, track: FretTrack): TransposeResult {
  if (!Number.isInteger(semitones)) {
    throw new RangeError(`Transposition must be whole semitones, got ${String(semitones)}`);
  }
  if (track.kind === 'drums' || semitones === 0) {
    return { ok: true, note, trillDropped: false, warnings: [] };
  }

  const fret = note.fret + semitones;
  const reason = failureAt(track, note.string, fret);
  if (reason !== undefined) {
    const midi = midiNote(track, note) + semitones;
    const alternatives =
      track.kind === 'fretted' && midi >= 0 && midi <= MIDI_MAX
        ? alternativePositions(track, midi, note.string)
        : [];
    return { ok: false, reason, midi, alternatives };
  }

  const { accidental, trill, ...rest } = note;
  const moved: Note = { ...rest, fret };
  if (accidental !== undefined && semitones % 12 === 0) moved.accidental = accidental;
  let trillDropped = false;
  if (trill !== undefined) {
    const trillFret = trill.fret + semitones;
    if (failureAt(track, note.string, trillFret) === undefined) {
      moved.trill = { ...trill, fret: trillFret };
    } else {
      trillDropped = true;
    }
  }
  const warnings: TransposeWarning[] =
    note.harmonic?.kind === 'natural' ? ['natural-harmonic-moved'] : [];
  return { ok: true, note: moved, trillDropped, warnings };
}
