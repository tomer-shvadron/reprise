import type { ChordQuality } from './qualities';

const DEFAULT: readonly string[] = [
  'R',
  '♭9',
  '9',
  '♭3',
  '3',
  '11',
  '♭5',
  '5',
  '♯5',
  '6',
  '♭7',
  '7',
];

/** Where a chord spells a tone differently from the default map (6/9 needs none, its 9 is the default's): suspended chords name the 2 and 4, not the 9 and 11. */
const OVERRIDES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  sus2: { 2: '2' },
  sus4: { 5: '4' },
  '7sus4': { 5: '4' },
  dim7: { 9: '𝄫7' },
  '13': { 9: '13' },
  '7#9': { 3: '♯9' },
};

/**
 * The degree label of each tone of a chord, parallel to `quality.intervals`. The root is `R`, not
 * `1`, so it reads differently from a scale's tonic.
 */
export function chordDegrees(quality: ChordQuality): string[] {
  const overrides = OVERRIDES[quality.suffix];
  return quality.intervals.map(
    (interval) => overrides?.[interval] ?? DEFAULT[((interval % 12) + 12) % 12] ?? '',
  );
}
