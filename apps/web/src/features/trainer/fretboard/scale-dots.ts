import { spellPitchClass } from '@/lib/chords';
import { keySignatureOf, scaleOf, type ScaleId } from '@/lib/insights';

import type { BoardShape } from './fretboard-model';

/** What a scale on the neck is: the tonic as a pitch class and as the player spelled it. */
export interface ScaleSpec {
  tonic: number;
  /** `E♭`, not `D♯`: the spelling the picker or the key engine gave. */
  tonicName: string;
  scaleId: ScaleId;
}

/** One position on the neck that holds a scale tone. */
export interface ScaleDot {
  /** 1 = highest-pitched string, as `Note.string`. */
  string: number;
  /** Where it sits on the neck, counted from the nut (the capo is already in it). */
  absolute: number;
  /** The scale degree, as `1`, `♭3`. */
  degree: string;
  name: string;
  tonic: boolean;
}

/** The overlay never draws more than this, so the SVG's element budget is safe on any neck. */
export const MAX_SCALE_DOTS = 250;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL = [0, 2, 4, 5, 7, 9, 11] as const;

const ACCIDENTALS = new Map([
  ['♯', 1],
  ['♭', -1],
  ['𝄪', 2],
  ['𝄫', -2],
]);

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/** The semitones a run of accidentals adds: `♭` is -1, `𝄪` is 2. */
export function alterOf(marks: string): number {
  return Array.from(marks).reduce((sum, mark) => sum + (ACCIDENTALS.get(mark) ?? 0), 0);
}

/** The tonic's spelling when nothing chose one: in the major key whose signature holds the scale. */
export function defaultTonicName(tonic: number, scaleId: ScaleId): string {
  const key = keySignatureOf(modulo(tonic + scaleOf(scaleId).parentOffset, 12), 'major');
  return spellPitchClass(tonic, key, true);
}

/**
 * The tones spelled by degree: the nth degree takes the nth letter from the tonic's, and the
 * accidental is whatever reaches the pitch. A seven-note scale therefore uses seven letters
 * (A blues has E♭ for its ♭5, D harmonic minor a C♯), which a key signature cannot say for the
 * scales that sit in no major key.
 */
export function scaleNotes(tonicName: string, scaleId: ScaleId): string[] {
  const scale = scaleOf(scaleId);
  const root = Math.max(0, LETTERS.indexOf(tonicName.charAt(0) as (typeof LETTERS)[number]));
  const rootAlter = alterOf(tonicName.slice(1));
  const tonicPc = modulo((NATURAL[root] ?? 0) + rootAlter, 12);
  return scale.intervals.map((interval, at) => {
    const number = Number.parseInt((scale.degrees[at] ?? '1').replace(/\D/g, ''), 10) || 1;
    const letter = (root + number - 1) % 7;
    const alter = modulo(tonicPc + interval - (NATURAL[letter] ?? 0) + 6, 12) - 6;
    // A double accidental in a scale of fewer than seven notes (the ♭5 of E♭ blues) reads as the
    // plain note a player knows (A); a seven-note scale keeps its letters, doubles and all.
    if (Math.abs(alter) > 1 && scale.intervals.length < 7) {
      return spellPitchClass(
        tonicPc + interval,
        { fifths: alter < 0 ? -3 : 3, minor: false },
        true,
      );
    }
    const accidental =
      alter === 0 ? '' : alter === 2 ? '𝄪' : alter === -2 ? '𝄫' : alter > 0 ? '♯' : '♭';
    return `${LETTERS[letter] ?? '?'}${accidental}`;
  });
}

/** `A minor pentatonic`, for the chip. */
export function scaleTitle(spec: Pick<ScaleSpec, 'tonicName' | 'scaleId'>): string {
  return `${spec.tonicName} ${scaleOf(spec.scaleId).name}`;
}

/** The accessible name of the overlay layer: `A minor pentatonic: A C D E G`. */
export function scaleLabel(spec: Pick<ScaleSpec, 'tonicName' | 'scaleId'>): string {
  return `${scaleTitle(spec)}: ${scaleNotes(spec.tonicName, spec.scaleId).join(' ')}`;
}

/**
 * Every position that sounds a tone of the scale. `tuning` is the open strings lowest first, as
 * the track stores it. A fret counts from the nut: the capo is the first position a string can
 * sound, and a banjo's short string starts `drone.fret` further on, sounding as if that fret were
 * its own nut. Dots run fret by fret, so a neck too long for the cap ends at a whole fret instead
 * of losing strings.
 */
export function scaleDots(
  board: BoardShape,
  tuning: readonly number[],
  spec: ScaleSpec,
): ScaleDot[] {
  const scale = scaleOf(spec.scaleId);
  const names = scaleNotes(spec.tonicName, spec.scaleId);
  const degreeOf = new Map(scale.intervals.map((interval, at) => [interval, at]));
  const dots: ScaleDot[] = [];
  for (let absolute = board.capo; absolute <= board.frets; absolute++) {
    const column: ScaleDot[] = [];
    for (let string = 1; string <= board.strings; string++) {
      const open = tuning[tuning.length - string];
      const shift = board.drone?.string === string ? board.drone.fret : 0;
      if (open === undefined || absolute < board.capo + shift) continue;
      const at = degreeOf.get(modulo(open + absolute - shift - spec.tonic, 12));
      if (at === undefined) continue;
      column.push({
        string,
        absolute,
        degree: scale.degrees[at] ?? '',
        name: names[at] ?? '',
        tonic: at === 0,
      });
    }
    if (dots.length + column.length > MAX_SCALE_DOTS) break;
    dots.push(...column);
  }
  return dots;
}
