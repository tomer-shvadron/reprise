import { spellPitchClass } from '@/lib/chords';
import { keySignatureOf, scaleName, scaleOf, type ScaleId } from '@/lib/insights';

import type { BoardShape } from './fretboard-model';

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

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/** The note names of a scale on a tonic, spelled in the key that holds it: `A C D E G`. */
export function scaleNotes(tonic: number, scaleId: ScaleId): string[] {
  const scale = scaleOf(scaleId);
  const key = keySignatureOf(modulo(tonic + scale.parentOffset, 12), 'major');
  return scale.intervals.map((interval) => spellPitchClass(tonic + interval, key, true));
}

/** The accessible name of the overlay layer: `A minor pentatonic: A C D E G`. */
export function scaleLabel(tonic: number, scaleId: ScaleId): string {
  return `${scaleName(tonic, scaleId)}: ${scaleNotes(tonic, scaleId).join(' ')}`;
}

/**
 * Every position that sounds a tone of the scale. `tuning` is the open strings lowest first, as
 * the track stores it. A fret counts from the nut: the capo is the first position a string can
 * sound, and a banjo's short string starts `drone.fret` further on, sounding as if that fret were
 * its own nut. Dots are ordered string by string, then by fret.
 */
export function scaleDots(
  board: BoardShape,
  tuning: readonly number[],
  tonic: number,
  scaleId: ScaleId,
): ScaleDot[] {
  const scale = scaleOf(scaleId);
  const names = scaleNotes(tonic, scaleId);
  const degreeOf = new Map(scale.intervals.map((interval, at) => [interval, at]));
  const dots: ScaleDot[] = [];
  for (let string = 1; string <= board.strings; string++) {
    const open = tuning[tuning.length - string];
    if (open === undefined) continue;
    const shift = board.drone?.string === string ? board.drone.fret : 0;
    for (let absolute = board.capo + shift; absolute <= board.frets; absolute++) {
      const at = degreeOf.get(modulo(open + absolute - shift - tonic, 12));
      if (at === undefined) continue;
      dots.push({
        string,
        absolute,
        degree: scale.degrees[at] ?? '',
        name: names[at] ?? '',
        tonic: at === 0,
      });
      if (dots.length >= MAX_SCALE_DOTS) return dots;
    }
  }
  return dots;
}
