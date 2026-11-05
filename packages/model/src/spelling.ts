import type { Clef } from './bar';
import type { KeySignature } from './master-bar';
import type { Accidental, Note } from './note';
import { midiNote } from './pitch';
import type { Track } from './track';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];

export type Alter = -2 | -1 | 0 | 1 | 2;

export interface Spelling {
  letter: Letter;
  /** Scientific octave: C4 is MIDI 60. Taken from the letter, so B#3 is MIDI 60. */
  octave: number;
  /** Semitones from the natural letter. */
  alter: Alter;
  /** What to print against the key signature, before any accidental earlier in the bar. */
  accidental?: Accidental;
}

export type PitchedClef = Exclude<Clef, 'percussion'>;

const NATURAL_PITCH_CLASS = [0, 2, 4, 5, 7, 9, 11] as const;
/** Sharpest first, so candidate lists read double sharp to double flat. */
const ALTERS: readonly Alter[] = [2, 1, 0, -1, -2];
const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const ACCIDENTAL_OF: Record<Alter, Accidental> = {
  [-2]: 'doubleFlat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'doubleSharp',
};
const ALTER_OF: Record<Accidental, Alter> = {
  doubleFlat: -2,
  flat: -1,
  natural: 0,
  sharp: 1,
  doubleSharp: 2,
};
/** Diatonic index of each clef's bottom line, counted as octave * 7 + letter index. */
const BOTTOM_LINE: Record<PitchedClef, number> = {
  treble: 4 * 7 + 2,
  bass: 2 * 7 + 4,
  alto: 3 * 7 + 3,
  tenor: 3 * 7 + 1,
};

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

function letterAt(index: number): Letter {
  return LETTERS[modulo(index, 7)] ?? 'C';
}

function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

/** The alteration the key signature gives a letter. */
export function keyAlter(key: Pick<KeySignature, 'fifths'>, letter: Letter): Alter {
  const position = SHARP_ORDER.indexOf(letter);
  if (key.fifths > 0) return position < key.fifths ? 1 : 0;
  return 6 - position < -key.fifths ? -1 : 0;
}

/** The letter and octave that spell `midi` with `alter`, if that letter exists. */
function spellingWith(midi: number, alter: Alter): Omit<Spelling, 'accidental'> | undefined {
  const natural = midi - alter;
  const index = NATURAL_PITCH_CLASS.findIndex((pitchClass) => pitchClass === modulo(natural, 12));
  if (index === -1) return undefined;
  return { letter: letterAt(index), octave: Math.floor(natural / 12) - 1, alter };
}

function withAccidental(spelling: Omit<Spelling, 'accidental'>, key: KeySignature): Spelling {
  return spelling.alter === keyAlter(key, spelling.letter)
    ? spelling
    : { ...spelling, accidental: ACCIDENTAL_OF[spelling.alter] };
}

/** Every spelling of `midi`, from double sharp down to double flat. */
function candidates(midi: number): Omit<Spelling, 'accidental'>[] {
  return ALTERS.flatMap((alter) => spellingWith(midi, alter) ?? []);
}

/** A minor key's seventh and sixth raised a semitone, for the harmonic and melodic minor. */
function raisedDegrees(key: KeySignature): { letter: Letter; alter: number }[] {
  if (!key.minor) return [];
  // Each fifth moves the major tonic four letters; the relative minor's seventh and sixth sit four
  // and three above that.
  return [4, 3].map((offset) => {
    const letter = letterAt(key.fifths * 4 + offset);
    return { letter, alter: keyAlter(key, letter) + 1 };
  });
}

/**
 * Spells a MIDI note for standard notation. An `explicit` accidental (a note's stored
 * `Note.accidental`) wins when it can spell the pitch. Otherwise the key's own notes come
 * first, then a minor key's raised seventh and sixth, then the natural letter, then a sharp in
 * sharp keys and C major or a flat in flat keys.
 */
export function spell(midi: number, key: KeySignature, explicit?: Accidental): Spelling {
  if (explicit !== undefined) {
    const stored = spellingWith(midi, ALTER_OF[explicit]);
    if (stored !== undefined) return withAccidental(stored, key);
  }
  const options = candidates(midi);
  const diatonic = options.find(({ letter, alter }) => alter === keyAlter(key, letter));
  if (diatonic !== undefined) return diatonic;
  const degrees = raisedDegrees(key);
  const raised = options.find(({ letter, alter }) =>
    degrees.some((degree) => degree.letter === letter && degree.alter === alter),
  );
  if (raised !== undefined) return withAccidental(raised, key);
  const sharpFirst = key.fifths >= 0;
  const best =
    spellingWith(midi, 0) ?? (sharpFirst ? spellingWith(midi, 1) : spellingWith(midi, -1));
  if (best === undefined) throw new RangeError(`Cannot spell MIDI note ${String(midi)}`);
  return withAccidental(best, key);
}

/** Spells a note on its track, honouring the note's stored accidental. */
export function spellNote(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  note: Pick<Note, 'string' | 'fret' | 'accidental'>,
  key: KeySignature,
): Spelling {
  return spell(midiNote(track, note), key, note.accidental);
}

/**
 * The note with its enharmonic flipped (C# to Db and back, E to Fb, B to Cb). Pitches with no
 * single-accidental alternative (D, G, A) cycle through their double sharp and double flat.
 * The stored accidental is cleared when the new spelling is the key's default.
 */
export function respell(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  note: Note,
  key: KeySignature,
): Note {
  const midi = midiNote(track, note);
  const current = spell(midi, key, note.accidental);
  const all = candidates(midi);
  const singles = all.filter(({ alter }) => Math.abs(alter) <= 1);
  const cycle = singles.length > 1 ? singles : all;
  const index = cycle.findIndex(({ alter }) => alter === current.alter);
  const next = cycle[modulo(index + 1, cycle.length)] ?? current;
  const respelled: Note = { ...note, accidental: ACCIDENTAL_OF[next.alter] };
  if (next.alter === spell(midi, key).alter) delete respelled.accidental;
  return respelled;
}

/**
 * Line or space on a five-line staff: 0 is the bottom line, 1 the space above it, 8 the top
 * line. Below 0 and above 8 are ledger positions; the even ones sit on ledger lines.
 */
export function staffPosition(
  spelling: Pick<Spelling, 'letter' | 'octave'>,
  clef: PitchedClef,
): number {
  return spelling.octave * 7 + letterIndex(spelling.letter) - BOTTOM_LINE[clef];
}
