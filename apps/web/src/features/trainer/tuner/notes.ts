import { spell } from '@reprise/model';

export const REFERENCE_HZ = { default: 440, min: 415, max: 466 } as const;

export function isValidReference(hz: number): boolean {
  return Number.isInteger(hz) && hz >= REFERENCE_HZ.min && hz <= REFERENCE_HZ.max;
}

export function midiFromHz(hz: number, referenceHz: number = REFERENCE_HZ.default): number {
  return 69 + 12 * Math.log2(hz / referenceHz);
}

export function hzFromMidi(midi: number, referenceHz: number = REFERENCE_HZ.default): number {
  return referenceHz * 2 ** ((midi - 69) / 12);
}

/** The whole note nearest a fractional MIDI value, and how many cents the value is above it. */
export function nearestNote(midi: number): { midi: number; cents: number } {
  const note = Math.round(midi);
  return { midi: note, cents: (midi - note) * 100 };
}

export interface NoteLabel {
  letter: string;
  /** `♯` for a sharp, otherwise empty: the tuner spells in C major. */
  accidental: string;
  octave: number;
  /** The whole name, for text and screen readers: "A♯2". */
  text: string;
}

const SIGNS: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** The note's name with sharps, through the model's speller. */
export function noteLabel(midi: number): NoteLabel {
  const { letter, alter, octave } = spell(midi, { fifths: 0, minor: false });
  const accidental = SIGNS[alter] ?? '';
  return { letter, accidental, octave, text: `${letter}${accidental}${String(octave)}` };
}

/** Cents from `target` to `midi`, signed: positive is sharp. */
export const centsFrom = (midi: number, target: number) => (midi - target) * 100;
