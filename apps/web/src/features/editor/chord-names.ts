import type { ChordDiagram, KeySignature } from '@reprise/model';

import { modulo, parseChordName, spellPitchClass } from '@/lib/chords/names';

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
  const parsed = parseChordName(name);
  if (!parsed) return undefined;
  if (semitones % 12 === 0) return name;
  const unicode = /[♯♭]/.test(parsed.rootText + (parsed.bassText ?? ''));
  const moved = spellPitchClass(parsed.root + semitones, key, unicode);
  const slash =
    parsed.bass === undefined ? '' : `/${spellPitchClass(parsed.bass + semitones, key, unicode)}`;
  return `${moved}${parsed.quality}${slash}`;
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
