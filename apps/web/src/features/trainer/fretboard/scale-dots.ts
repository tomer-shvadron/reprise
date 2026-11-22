import { spellPitchClass } from '@/lib/chords';
import { keySignatureOf, scaleOf, type ScaleId } from '@/lib/insights';

import type { BoardShape } from './fretboard-model';
import { alterOf, MAX_NECK_TONES, modulo, neckTones, spellByDegree } from './neck-tones';

export { alterOf };

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
export const MAX_SCALE_DOTS = MAX_NECK_TONES;

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
  return spellByDegree(tonicName, scale.intervals, scale.degrees);
}

/** `A minor pentatonic`, for the chip. */
export function scaleTitle(spec: Pick<ScaleSpec, 'tonicName' | 'scaleId'>): string {
  return `${spec.tonicName} ${scaleOf(spec.scaleId).name}`;
}

/** The accessible name of the overlay layer: `A minor pentatonic: A C D E G`. */
export function scaleLabel(spec: Pick<ScaleSpec, 'tonicName' | 'scaleId'>): string {
  return `${scaleTitle(spec)}: ${scaleNotes(spec.tonicName, spec.scaleId).join(' ')}`;
}

/** Every position that sounds a tone of the scale; see `neckTones` for how the neck is counted. */
export function scaleDots(
  board: BoardShape,
  tuning: readonly number[],
  spec: ScaleSpec,
): ScaleDot[] {
  const scale = scaleOf(spec.scaleId);
  const names = scaleNotes(spec.tonicName, spec.scaleId);
  return neckTones(board, tuning, spec.tonic, scale.intervals).map(({ string, absolute, at }) => ({
    string,
    absolute,
    degree: scale.degrees[at] ?? '',
    name: names[at] ?? '',
    tonic: at === 0,
  }));
}
