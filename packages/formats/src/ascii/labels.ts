import { spell, type KeySignature } from '@reprise/model';

const SHARP_KEY: KeySignature = { fifths: 0, minor: false };
// One flat in the key: every black key then spells as a flat, and the natural notes stay natural.
const FLAT_KEY: KeySignature = { fifths: -1, minor: false };

function nameOf(midi: number, key: KeySignature): string {
  const { letter, alter } = spell(midi, key);
  if (alter === 0) return letter;
  return letter + (alter > 0 ? '#' : 'b').repeat(Math.abs(alter));
}

export interface StringLabels {
  /** Highest string first, padded to one width, as printed before each line's `|`. */
  lines: string[];
  /** Lowest string first, as the tuning is read. */
  tuning: string[];
}

/**
 * Open-string names in C with sharps; a tuning whose every string is altered (E flat standard)
 * is spelled with flats. The highest string is always lowercased, the usual `e`, which is how a
 * guitarist tells it from the low E.
 */
export function stringLabels(tuning: readonly number[]): StringLabels {
  const sharps = tuning.map((midi) => nameOf(midi, SHARP_KEY));
  const names = sharps.every((name) => name.length > 1)
    ? tuning.map((midi) => nameOf(midi, FLAT_KEY))
    : sharps;
  const top = names.slice().reverse();
  const [highest, ...rest] = top;
  const lines =
    highest === undefined ? top : [highest.slice(0, 1).toLowerCase() + highest.slice(1), ...rest];
  const width = Math.max(1, ...lines.map((name) => name.length));
  return { lines: lines.map((name) => name.padEnd(width)), tuning: names };
}
