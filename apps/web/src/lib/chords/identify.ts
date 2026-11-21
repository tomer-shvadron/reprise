import type { KeySignature } from '@reprise/model';

import { modulo, spellPitchClass, type PitchClass } from './names';
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
      const slash = root === bass ? '' : `/${spellPitchClass(bass, key)}`;
      const entry: ChordName = {
        name: `${spellPitchClass(root, key)}${quality.suffix}${slash}`,
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
