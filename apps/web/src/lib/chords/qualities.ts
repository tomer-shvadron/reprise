import { parseChordName, type PitchClass } from './names';

export interface ChordQuality {
  /** The suffix written after the root: `m7`, `maj7`; empty for a major chord. */
  suffix: string;
  /** Other ways a chart writes it. */
  aliases: readonly string[];
  /** Semitones above the root, root first. */
  intervals: readonly number[];
  /** The intervals a shape may leave out. Every other one, the root included, must sound. */
  optional: readonly number[];
  /** Intervals that name the chord when they sound but that a shape never plays: the third of an 11 clashes with the 11. */
  avoid?: readonly number[];
}

// A shape needs three distinct tones, so a triad keeps its fifth; the fifth may go from any chord of
// four or more tones, and the lower extensions of the big chords too: a 13 on a guitar has no room
// for its 9 and 5. The third and the seventh are what name a chord, so they stay (an 11 may lose
// its third, see below).
const q = (
  suffix: string,
  aliases: readonly string[],
  intervals: readonly number[],
  optional: readonly number[] = [],
  avoid: readonly number[] = [],
): ChordQuality => ({ suffix, aliases, intervals, optional, ...(avoid.length > 0 && { avoid }) });

export const QUALITIES: readonly ChordQuality[] = [
  q('', ['maj', 'M'], [0, 4, 7]),
  q('m', ['min', 'mi', '-'], [0, 3, 7]),
  q('5', [], [0, 7]),
  q('dim', ['°'], [0, 3, 6]),
  q('dim7', ['°7'], [0, 3, 6, 9]),
  q('aug', ['+', 'aug5'], [0, 4, 8]),
  q('sus2', [], [0, 2, 7]),
  q('sus4', ['sus'], [0, 5, 7]),
  q('6', ['maj6', 'M6'], [0, 4, 7, 9], [7]),
  q('m6', ['min6', '-6'], [0, 3, 7, 9], [7]),
  q('6/9', ['69'], [0, 4, 7, 9, 2], [7]),
  q('7', ['dom7'], [0, 4, 7, 10], [7]),
  q('maj7', ['M7', 'Δ', 'Δ7', 'ma7'], [0, 4, 7, 11], [7]),
  q('m7', ['min7', 'mi7', '-7'], [0, 3, 7, 10], [7]),
  q('m(maj7)', ['mM7', 'mmaj7', 'minmaj7', 'm#7'], [0, 3, 7, 11], [7]),
  q('m7b5', ['ø', 'ø7', 'm7-5', 'min7b5', '-7b5'], [0, 3, 6, 10]),
  q('7sus4', ['7sus'], [0, 5, 7, 10], [7]),
  q('add9', ['add2'], [0, 4, 7, 2], [7]),
  q('m(add9)', ['madd9', 'madd2'], [0, 3, 7, 2], [7]),
  q('9', ['dom9'], [0, 4, 7, 10, 2], [7]),
  q('maj9', ['M9', 'Δ9', 'ma9'], [0, 4, 7, 11, 2], [7]),
  q('m9', ['min9', '-9'], [0, 3, 7, 10, 2], [7]),
  // An 11 chord usually drops its third, which clashes with the 11 a minor ninth above it.
  q('11', [], [0, 4, 7, 10, 2, 5], [7, 2, 4], [4]),
  q('m11', ['min11', '-11'], [0, 3, 7, 10, 2, 5], [7, 2]),
  q('13', [], [0, 4, 7, 10, 2, 9], [7, 2]),
  q('7b9', ['7-9'], [0, 4, 7, 10, 1], [7]),
  q('7#9', ['7+9'], [0, 4, 7, 10, 3], [7]),
  q('7#5', ['+7', 'aug7', '7+5', '7+'], [0, 4, 8, 10]),
  q('7b5', ['7-5'], [0, 4, 6, 10]),
];

/** A chart's spelling reduced to what separates one quality from another. */
const normalise = (text: string): string =>
  text
    .replaceAll(/[()\s]/g, '')
    .replaceAll('♭', 'b')
    .replaceAll('♯', '#');

const exact = new Map<string, ChordQuality>();
const folded = new Map<string, ChordQuality>();
for (const quality of QUALITIES) {
  for (const text of [quality.suffix, ...quality.aliases]) {
    exact.set(normalise(text), quality);
    // `M` and `m` differ only by case and `M7` and `m7` too, so case is folded only for the
    // longer spellings (`Maj7`, `MIN`), where it never collides.
    if (text.length >= 3) folded.set(normalise(text).toLowerCase(), quality);
  }
}

/** The quality a chart's suffix names (`min7`, `Δ`, `ø`), or `undefined` when the table lacks it. */
export function qualityOf(text: string): ChordQuality | undefined {
  const key = normalise(text);
  return exact.get(key) ?? folded.get(key.toLowerCase());
}

export interface ChordSpec {
  root: PitchClass;
  quality: ChordQuality;
  /** The slash bass, when the name has one. */
  bass?: PitchClass;
}

/** A chord name as a spec, or `undefined` when it is not a chord or its quality is not in the table. */
export function parseChord(name: string): ChordSpec | undefined {
  const parsed = parseChordName(name);
  if (!parsed) return undefined;
  const quality = qualityOf(parsed.quality);
  if (!quality) return undefined;
  return parsed.bass === undefined
    ? { root: parsed.root, quality }
    : { root: parsed.root, quality, bass: parsed.bass };
}
