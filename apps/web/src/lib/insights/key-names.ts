import type { KeySignature } from '@reprise/model';

import { spellPitchClass } from '../chords';
import { scaleOf, type ScaleId } from './scales';

export type KeyQuality = 'major' | 'minor';

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/** Fifths of the major key on a pitch class, in -5..6 (C♯ is -5, as D♭). */
function majorFifths(pitchClass: number): number {
  const fifths = modulo(pitchClass * 7, 12);
  return fifths > 6 ? fifths - 12 : fifths;
}

/**
 * The key signature for a tonic and mode, in -6..6 fifths. F♯ and G♭ are one pitch: the file's own
 * signature decides when it names either, otherwise a major key takes sharps and a minor key
 * flats. A signature has no sharper or flatter choice for any other pitch inside -6..6.
 */
export function keySignatureOf(
  tonic: number,
  quality: KeyQuality,
  fileKey?: KeySignature,
): KeySignature {
  const relativeMajor = quality === 'major' ? tonic : modulo(tonic + 3, 12);
  const fifths = majorFifths(relativeMajor);
  if (Math.abs(fifths) === 6) {
    const fileFifths = fileKey?.fifths;
    if (fileFifths === 6 || fileFifths === -6)
      return { fifths: fileFifths, minor: quality === 'minor' };
    return { fifths: quality === 'major' ? 6 : -6, minor: quality === 'minor' };
  }
  return { fifths, minor: quality === 'minor' };
}

/** `C♯ minor`, `D♭ major`; a result with no third is named by its tonic alone. */
export function keyName(
  tonic: number,
  quality: KeyQuality | 'none',
  fileKey?: KeySignature,
): string {
  const signature = keySignatureOf(tonic, quality === 'minor' ? 'minor' : 'major', fileKey);
  const root = spellPitchClass(tonic, signature, true);
  return quality === 'none' ? root : `${root} ${quality}`;
}

/** `E Dorian`, `A minor pentatonic`: the tonic spelled in the key that holds the scale. */
export function scaleName(tonic: number, scale: ScaleId, fileKey?: KeySignature): string {
  const entry = scaleOf(scale);
  const parent = keySignatureOf(modulo(tonic + entry.parentOffset, 12), 'major', fileKey);
  const root = spellPitchClass(tonic, parent, true);
  return `${root} ${entry.name}`;
}
