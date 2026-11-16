import { spell, type ChordDiagram, type KeySignature } from '@reprise/model';

const NAME = /^([A-G])([#b♯♭]{0,2})(.*?)(?:\/([A-G])([#b♯♭]{0,2}))?$/;
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER: Record<string, number> = { '#': 1, '♯': 1, b: -1, '♭': -1 };
// What may follow a root in a chord name; any letter left over is a word ("Riff", "Break"), not a quality.
const QUALITY = /maj|ma|min|mi|dim|aug|sus|add|alt|omit|dom|no|[mb#♯♭°ø+\-x]/gi;

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

function alterOf(text: string): number {
  return text.split('').reduce((sum, char) => sum + (ALTER[char] ?? 0), 0);
}

/** A root or bass moved by `semitones` and spelled for `key`, in the glyphs the original used. */
function respellNote(
  letter: string,
  accidentals: string,
  semitones: number,
  key: KeySignature,
  unicode: boolean,
): string {
  const pitch = modulo((PITCH_CLASS[letter] ?? 0) + alterOf(accidentals) + semitones, 12);
  let spelled = spell(60 + pitch, key);
  // A chord chart has no double accidentals: a sharp minor key's raised degree is written as the natural.
  if (Math.abs(spelled.alter) === 2) {
    spelled = spell(60 + pitch, { fifths: key.fifths < 0 ? -1 : 0, minor: false });
  }
  const sharp = unicode ? '♯' : '#';
  const flat = unicode ? '♭' : 'b';
  const marks =
    spelled.alter > 0 ? sharp.repeat(spelled.alter) : flat.repeat(Math.abs(spelled.alter));
  return `${spelled.letter}${marks}`;
}

/**
 * A chord name with its root and slash bass moved by `semitones` and spelled for `key`, the
 * quality text kept as typed. `undefined` when the name is not a chord (`N.C.`, `Riff`), which
 * the caller leaves alone and counts. A move by a whole number of octaves returns the name as is.
 */
export function transposeChordName(
  name: string,
  semitones: number,
  key: KeySignature,
): string | undefined {
  const match = NAME.exec(name.trim());
  const [, root, rootMarks = '', quality = '', bass, bassMarks = ''] = match ?? [];
  if (!root || /[A-Za-z]/.test(quality.replaceAll(QUALITY, ''))) return undefined;
  if (semitones % 12 === 0) return name;
  const unicode = /[♯♭]/.test(rootMarks + bassMarks);
  const moved = respellNote(root, rootMarks, semitones, key, unicode);
  const slash = bass ? `/${respellNote(bass, bassMarks, semitones, key, unicode)}` : '';
  return `${moved}${quality}${slash}`;
}

/**
 * The diagram `semitones` up the neck when it is a movable shape (no open string) that stays on
 * frets 1 to `fretCount`; `undefined` when it cannot move, and the caller removes it.
 */
export function shiftDiagram(
  diagram: ChordDiagram,
  semitones: number,
  fretCount: number,
): ChordDiagram | undefined {
  if (diagram.frets.some((fret) => fret === 0)) return undefined;
  const fretted = diagram.frets.filter((fret): fret is number => fret !== null);
  const lowest = Math.min(...fretted, ...(diagram.barres ?? []).map((b) => b.fret));
  const highest = Math.max(...fretted, ...(diagram.barres ?? []).map((b) => b.fret));
  if (lowest + semitones < 1 || highest + semitones > fretCount) return undefined;
  const { barres, ...rest } = diagram;
  return {
    ...rest,
    baseFret: Math.max(1, diagram.baseFret + semitones),
    frets: diagram.frets.map((fret) => (fret === null ? null : fret + semitones)),
    ...(barres && { barres: barres.map((barre) => ({ ...barre, fret: barre.fret + semitones })) }),
  };
}

/**
 * A key signature moved by `semitones`: the spelling with the fewest accidentals, and at the
 * tritone the side the original was on (flats stay flats). The mode is kept. A move by whole
 * octaves keeps the key as written.
 */
export function transposeKey(key: KeySignature, semitones: number): KeySignature {
  if (semitones % 12 === 0) return key;
  const target = modulo(key.fifths + 7 * semitones, 12);
  // A and C minor sit on the flat side of the tritone: E♭ minor is the usual spelling, not D♯.
  const flatSide = key.fifths < 0 || (key.fifths === 0 && key.minor);
  const candidates = [target, target - 12].filter((fifths) => fifths >= -7 && fifths <= 7);
  const best = candidates.reduce((a, b) => {
    const [x, y] = [Math.abs(a), Math.abs(b)];
    if (x !== y) return x < y ? a : b;
    return flatSide ? Math.min(a, b) : Math.max(a, b);
  });
  return { ...key, fifths: best };
}
