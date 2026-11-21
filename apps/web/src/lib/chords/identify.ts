import { keyAlter, LETTERS, type KeySignature, type Letter } from '@reprise/model';

import { modulo, type PitchClass } from './names';
import { QUALITIES } from './qualities';

export interface ChordName {
  /** The name as a chart writes it, spelled for the key: `C/E`, `Am7`. */
  name: string;
  root: PitchClass;
  /** The canonical suffix of the quality. */
  quality: string;
  /** The bass pitch class when it is not the root (a slash chord). */
  bass?: PitchClass;
  /** The intervals of the quality the notes leave out. */
  missing: number[];
}

/**
 * The chord names that fit sounding pitches (MIDI notes), best first. Each pitch class present is
 * tried as the root and its interval set matched against the table: the notes must all belong to
 * the quality and hold all its required tones. Ranked by root in the bass, then fewest missing
 * tones, then the simpler quality. Two pitch classes make only a `5` chord; one or an unmatched
 * cluster makes none.
 */
export function nameChord(pitches: readonly number[], key: KeySignature): ChordName[] {
  if (pitches.length === 0) return [];
  const lowest = Math.min(...pitches);
  const bass = modulo(lowest, 12);
  const present = new Set(pitches.map((pitch) => modulo(pitch, 12)));
  if (present.size < 2) return [];

  const matches: { entry: ChordName; rank: [number, number, number, number] }[] = [];
  for (const root of present) {
    const intervals = new Set([...present].map((pc) => modulo(pc - root, 12)));
    QUALITIES.forEach((quality, order) => {
      if (present.size === 2 && quality.suffix !== '5') return;
      if (![...intervals].every((i) => quality.intervals.includes(i))) return;
      const missing = quality.intervals.filter((i) => !intervals.has(i));
      if (missing.some((i) => !quality.optional.includes(i))) return;
      // A quality with fewer than three tones cannot lose one.
      if (present.size < Math.min(3, quality.intervals.length)) return;
      const spelled = spellChord(root, [...intervals], key);
      const slash = root === bass ? '' : `/${spelled.get(bass) ?? ''}`;
      const entry: ChordName = {
        name: `${spelled.get(root) ?? ''}${quality.suffix}${slash}`,
        root,
        quality: quality.suffix,
        ...(root !== bass && { bass }),
        missing,
      };
      matches.push({
        entry,
        rank: [root === bass ? 0 : 1, missing.length, quality.intervals.length, order],
      });
    });
  }
  matches.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const diff = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return matches.map((match) => match.entry);
}

const NATURAL = [0, 2, 4, 5, 7, 9, 11];
// Letters above the root for each interval: a third is two letters up, a fifth four.
const DEGREE = [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6];

interface Spelling {
  names: Map<PitchClass, string>;
  /** Accidentals the key does not already carry. */
  cost: number;
}

/**
 * The note names of a chord, each tone on the letter its degree calls for (the third on the root's
 * letter plus two, and so on), so a B-flat chord is B-flat, D, F and never A-sharp, C double sharp.
 * Both spellings of a black-key root are tried; the one with no double accidental and the fewest
 * accidentals against the key wins, and a tie takes the key's side. Reading a name back by pitch
 * class gives the root, the bass and every tone.
 */
function spellChord(
  root: PitchClass,
  intervals: readonly number[],
  key: KeySignature,
): Map<PitchClass, string> {
  const candidates: Spelling[] = [];
  LETTERS.forEach((letter, index) => {
    const alter = ((root - (NATURAL[index] ?? 0) + 18) % 12) - 6;
    if (Math.abs(alter) > 1) return;
    const names = new Map<PitchClass, string>();
    let cost = 0;
    for (const interval of intervals) {
      const pc = modulo(root + interval, 12);
      const toneIndex = (index + (DEGREE[interval] ?? 0)) % 7;
      const toneAlter = ((pc - (NATURAL[toneIndex] ?? 0) + 18) % 12) - 6;
      // A double accidental is last resort: some spelling must always come out.
      if (Math.abs(toneAlter) > 1) cost += 100;
      const toneLetter: Letter = LETTERS[toneIndex] ?? 'C';
      if (toneAlter !== keyAlter(key, toneLetter)) cost++;
      const marks = toneAlter > 0 ? '#'.repeat(toneAlter) : 'b'.repeat(-toneAlter);
      names.set(pc, `${toneLetter}${marks}`);
    }
    candidates.push({ names, cost });
  });
  const sharpSide = key.fifths >= 0;
  const sharps = (spelling: Spelling): number =>
    [...spelling.names.values()].filter((name) => name.includes('#')).length;
  candidates.sort(
    (a, b) => a.cost - b.cost || (sharpSide ? sharps(b) - sharps(a) : sharps(a) - sharps(b)),
  );
  return candidates[0]?.names ?? new Map<PitchClass, string>();
}
