import { spellPitchClass } from '@/lib/chords';

import type { BoardShape } from './fretboard-model';

/** The overlays never draw more than this, so the SVG's element budget is safe on any neck. */
export const MAX_NECK_TONES = 250;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL = [0, 2, 4, 5, 7, 9, 11] as const;

const ACCIDENTALS = new Map([
  ['♯', 1],
  ['#', 1],
  ['♭', -1],
  ['b', -1],
  ['𝄪', 2],
  ['𝄫', -2],
]);

export const modulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

/** The semitones a run of accidentals adds: `♭` is -1, `𝄪` is 2; ASCII `#` and `b` count too. */
export function alterOf(marks: string): number {
  return Array.from(marks).reduce((sum, mark) => sum + (ACCIDENTALS.get(mark) ?? 0), 0);
}

/**
 * The tones spelled by degree: the nth degree takes the nth letter from the root's, and the
 * accidental is whatever reaches the pitch. A seven-note scale therefore uses seven letters, which
 * a key signature cannot say for the scales that sit in no major key. `degrees` are labels such
 * as `♭3` or `13`; the number in them picks the letter.
 */
export function spellByDegree(
  rootName: string,
  intervals: readonly number[],
  degrees: readonly string[],
): string[] {
  const root = Math.max(0, LETTERS.indexOf(rootName.charAt(0) as (typeof LETTERS)[number]));
  const rootPc = modulo((NATURAL[root] ?? 0) + alterOf(rootName.slice(1)), 12);
  return intervals.map((interval, at) => {
    const number = Number.parseInt((degrees[at] ?? '1').replace(/\D/g, ''), 10) || 1;
    const letter = (root + number - 1) % 7;
    const alter = modulo(rootPc + interval - (NATURAL[letter] ?? 0) + 6, 12) - 6;
    // A double accidental in a set of fewer than seven tones (the ♭5 of E♭ blues, the 𝄫7 of a
    // diminished seventh chord) reads as the plain note a player knows; a seven-note scale keeps
    // its letters, doubles and all.
    if (Math.abs(alter) > 1 && intervals.length < 7) {
      return spellPitchClass(rootPc + interval, { fifths: alter < 0 ? -3 : 3, minor: false }, true);
    }
    const accidental =
      alter === 0 ? '' : alter === 2 ? '𝄪' : alter === -2 ? '𝄫' : alter > 0 ? '♯' : '♭';
    return `${LETTERS[letter] ?? '?'}${accidental}`;
  });
}

/** One position on the neck that sounds a tone of the set. */
export interface NeckTone {
  /** 1 = highest-pitched string, as `Note.string`. */
  string: number;
  /** Where it sits on the neck, counted from the nut (the capo is already in it). */
  absolute: number;
  /** Which of the `intervals` it is. */
  at: number;
}

/**
 * Every position that sounds one of `intervals` above `root` (a pitch class). `tuning` is the open
 * strings lowest first, as the track stores it. A fret counts from the nut: the capo is the first
 * position a string can sound, and a banjo's short string starts `drone.fret` further on, sounding
 * as if that fret were its own nut. Tones run fret by fret, so a neck too long for the cap ends at
 * a whole fret instead of losing strings.
 */
export function neckTones(
  board: BoardShape,
  tuning: readonly number[],
  root: number,
  intervals: readonly number[],
): NeckTone[] {
  const indexOf = new Map(intervals.map((interval, at) => [modulo(interval, 12), at]));
  const tones: NeckTone[] = [];
  for (let absolute = board.capo; absolute <= board.frets; absolute++) {
    const column: NeckTone[] = [];
    for (let string = 1; string <= board.strings; string++) {
      const open = tuning[tuning.length - string];
      const shift = board.drone?.string === string ? board.drone.fret : 0;
      if (open === undefined || absolute < board.capo + shift) continue;
      const at = indexOf.get(modulo(open + absolute - shift - root, 12));
      if (at === undefined) continue;
      column.push({ string, absolute, at });
    }
    if (tones.length + column.length > MAX_NECK_TONES) break;
    tones.push(...column);
  }
  return tones;
}
