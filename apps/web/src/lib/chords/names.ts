import { spell, type KeySignature } from '@reprise/model';

/** A pitch class, 0 (C) to 11 (B). */
export type PitchClass = number;

const NAME = /^([A-G])([#b♯♭]{0,2})(.*?)(?:\/([A-G])([#b♯♭]{0,2}))?$/;
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER: Record<string, number> = { '#': 1, '♯': 1, b: -1, '♭': -1 };
// What may follow a root in a chord name; any letter left over is a word ("Riff", "Break"), not a quality.
const QUALITY = /maj|ma(?!dd|ug|lt)|min|mi|dim|aug|sus|add|alt|omit|dom|no|[mb#♯♭°ø+\-x]/gi;

export const modulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

function alterOf(text: string): number {
  return text.split('').reduce((sum, char) => sum + (ALTER[char] ?? 0), 0);
}

export interface ParsedChordName {
  root: PitchClass;
  /** The root as written, letter and accidentals: `F#`, `B♭`. */
  rootText: string;
  /** What sits between the root and the slash bass, as typed; empty for a major chord. */
  quality: string;
  bass?: PitchClass;
  /** The slash bass as written. */
  bassText?: string;
}

/**
 * A chord name split into root, quality text and slash bass. `undefined` when the text is not a
 * chord name (`N.C.`, `Riff`); it never throws, whatever the input. The quality text is not
 * checked against the table of qualities: `qualityOf` does that.
 */
export function parseChordName(name: string): ParsedChordName | undefined {
  const match = NAME.exec(name.trim());
  const [, letter, rootMarks = '', quality = '', bassLetter, bassMarks = ''] = match ?? [];
  if (!letter || /[A-Za-z]/.test(quality.replaceAll(QUALITY, ''))) return undefined;
  const parsed: ParsedChordName = {
    root: modulo((PITCH_CLASS[letter] ?? 0) + alterOf(rootMarks), 12),
    rootText: `${letter}${rootMarks}`,
    quality,
  };
  if (bassLetter) {
    parsed.bass = modulo((PITCH_CLASS[bassLetter] ?? 0) + alterOf(bassMarks), 12);
    parsed.bassText = `${bassLetter}${bassMarks}`;
  }
  return parsed;
}

/**
 * A pitch class spelled for `key`, as `C#` or `Db` (`C♯` with `unicode`). A chord chart has no
 * double accidentals: a sharp minor key's raised degree is written as the natural.
 */
export function spellPitchClass(pitch: PitchClass, key: KeySignature, unicode = false): string {
  const normal = modulo(pitch, 12);
  let spelled = spell(60 + normal, key);
  if (Math.abs(spelled.alter) === 2) {
    spelled = spell(60 + normal, { fifths: key.fifths < 0 ? -1 : 0, minor: false });
  }
  const sharp = unicode ? '♯' : '#';
  const flat = unicode ? '♭' : 'b';
  const marks =
    spelled.alter > 0 ? sharp.repeat(spelled.alter) : flat.repeat(Math.abs(spelled.alter));
  return `${spelled.letter}${marks}`;
}
