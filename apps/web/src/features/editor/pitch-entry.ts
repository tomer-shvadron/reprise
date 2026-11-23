import {
  keyAlter,
  LETTERS,
  spell,
  staffPosition,
  type Accidental,
  type Alter,
  type Clef,
  type KeySignature,
  type Letter,
  type Note,
  type PitchedClef,
  type Track,
} from '@reprise/model';

const NATURAL: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MIDI_TOP = 127;

/** The treble clef's middle line; a clef the staff has none for falls back to it. */
const FALLBACK_CLEF: PitchedClef = 'treble';
const C_MAJOR: KeySignature = { fifths: 0, minor: false };
const SIGNS: Record<Alter, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** The MIDI key of `letter` in `octave` (scientific: C4 is 60), altered by `alter`. */
const keyOf = (letter: Letter, octave: number, alter: number): number =>
  12 * (octave + 1) + NATURAL[letter] + alter;

/** Every key a letter can sound at under the key signature, lowest first. */
function occurrences(letter: Letter, key: KeySignature): number[] {
  const alter = keyAlter(key, letter);
  const found: number[] = [];
  for (let octave = -1; octave <= 9; octave += 1) {
    const midi = keyOf(letter, octave, alter);
    if (midi >= 0 && midi <= MIDI_TOP) found.push(midi);
  }
  return found;
}

/**
 * The key a typed letter sounds at: the bar's key signature gives its alteration, and the octave
 * is the one nearest `reference`, a tritone going up. Undefined when no octave fits MIDI.
 */
export function letterPitch(
  letter: Letter,
  reference: number,
  key: KeySignature,
): number | undefined {
  let best: number | undefined;
  for (const midi of occurrences(letter, key)) {
    if (best === undefined) {
      best = midi;
      continue;
    }
    const gap = Math.abs(midi - reference);
    const bestGap = Math.abs(best - reference);
    if (gap < bestGap || (gap === bestGap && midi > best)) best = midi;
  }
  return best;
}

/** The nearest occurrence of a letter above `highest`, for adding a note to a chord. */
export function chordPitch(letter: Letter, highest: number, key: KeySignature): number | undefined {
  return occurrences(letter, key).find((midi) => midi > highest);
}

/** A staff's clef; a percussion clef never reaches a pitched track, so it reads as treble. */
export const pitchedClef = (clef: Clef): PitchedClef =>
  clef === 'percussion' ? FALLBACK_CLEF : clef;

/**
 * The key written on the middle line of a clef, where a pitched track's cursor starts. The track's
 * `octaveShift` is written minus sounding octaves, as `staffPosition` reads it.
 */
export function middleLine(clef: Clef, octaveShift: number): number {
  const shown = pitchedClef(clef);
  for (let midi = 0; midi <= MIDI_TOP; midi += 1) {
    const spelling = spell(midi, C_MAJOR);
    if (spelling.alter === 0 && staffPosition(spelling, shown, octaveShift) === 4) return midi;
  }
  return 71;
}

const indexOfLetter = (letter: Letter): number => LETTERS.indexOf(letter);

/**
 * The lane one line or space up (`delta` -1, as the string keys count) or down (+1) the staff, in
 * the bar's key. When a note of the beat already sits on that line or space, the lane takes its
 * key whatever its accidental, so the notes of a chord stay reachable. Undefined past MIDI.
 */
export function stepPitch(
  midi: number,
  key: KeySignature,
  delta: -1 | 1,
  beatNotes: readonly Pick<Note, 'fret' | 'accidental'>[] = [],
): number | undefined {
  const here = spell(midi, key, beatNotes.find((note) => note.fret === midi)?.accidental);
  const line = here.octave * 7 + indexOfLetter(here.letter) - delta;
  const octave = Math.floor(line / 7);
  const letter = LETTERS[((line % 7) + 7) % 7];
  if (!letter) return undefined;
  const onLine = beatNotes.find((note) => {
    const spelling = spell(note.fret, key, note.accidental);
    return spelling.octave * 7 + indexOfLetter(spelling.letter) === line;
  });
  if (onLine) return onLine.fret;
  const next = keyOf(letter, octave, keyAlter(key, letter));
  return next >= 0 && next <= MIDI_TOP ? next : undefined;
}

/** "F♯4": the letter, its sign against the natural, and the octave; for the status line and refusals. */
export function pitchName(midi: number, key: KeySignature, accidental?: Accidental): string {
  const spelling = spell(midi, key, accidental);
  return `${spelling.letter}${SIGNS[spelling.alter]}${String(spelling.octave)}`;
}

/** The clef a bar of a track is drawn in: the last change at or before it, else the track's (treble when it has none). */
export function clefOf(track: Pick<Track, 'bars' | 'display'>, bar: number): PitchedClef {
  for (let index = Math.min(bar, track.bars.length - 1); index >= 0; index -= 1) {
    const change = track.bars[index]?.clef;
    if (change !== undefined) return pitchedClef(change);
  }
  return pitchedClef(track.display.clef ?? FALLBACK_CLEF);
}
