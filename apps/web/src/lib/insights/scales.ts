/** Scale identifiers are camelCase, like the model's enums. */
export type ScaleId =
  | 'ionian'
  | 'aeolian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'phrygianDominant'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'majorBlues';

export interface Scale {
  id: ScaleId;
  /** The name as it follows a tonic: `Dorian`, `minor pentatonic`. */
  name: string;
  /** Semitones above the tonic, ascending from 0. */
  intervals: readonly number[];
  /** The degree names, as `1`, `♭3`, `♯4`. */
  degrees: readonly string[];
  /**
   * Semitones above the tonic of the major key whose signature spells the scale: E Dorian is in
   * the key of D major, so 10.
   */
  parentOffset: number;
}

// The order is the tie-break: major and natural minor come before their modes.
export const SCALES: readonly Scale[] = [
  {
    id: 'ionian',
    name: 'major',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    degrees: ['1', '2', '3', '4', '5', '6', '7'],
    parentOffset: 0,
  },
  {
    id: 'aeolian',
    name: 'natural minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    degrees: ['1', '2', '♭3', '4', '5', '♭6', '♭7'],
    parentOffset: 3,
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    degrees: ['1', '2', '3', '4', '5', '6', '♭7'],
    parentOffset: 5,
  },
  {
    id: 'dorian',
    name: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    degrees: ['1', '2', '♭3', '4', '5', '6', '♭7'],
    parentOffset: 10,
  },
  {
    id: 'lydian',
    name: 'Lydian',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    degrees: ['1', '2', '3', '♯4', '5', '6', '7'],
    parentOffset: 7,
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    degrees: ['1', '♭2', '♭3', '4', '5', '♭6', '♭7'],
    parentOffset: 8,
  },
  {
    id: 'locrian',
    name: 'Locrian',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    degrees: ['1', '♭2', '♭3', '4', '♭5', '♭6', '♭7'],
    parentOffset: 1,
  },
  {
    id: 'harmonicMinor',
    name: 'harmonic minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    degrees: ['1', '2', '♭3', '4', '5', '♭6', '7'],
    parentOffset: 3,
  },
  {
    id: 'melodicMinor',
    name: 'melodic minor',
    intervals: [0, 2, 3, 5, 7, 9, 11],
    degrees: ['1', '2', '♭3', '4', '5', '6', '7'],
    parentOffset: 3,
  },
  {
    id: 'phrygianDominant',
    name: 'Phrygian dominant',
    intervals: [0, 1, 4, 5, 7, 8, 10],
    degrees: ['1', '♭2', '3', '4', '5', '♭6', '♭7'],
    parentOffset: 8,
  },
  {
    id: 'majorPentatonic',
    name: 'major pentatonic',
    intervals: [0, 2, 4, 7, 9],
    degrees: ['1', '2', '3', '5', '6'],
    parentOffset: 0,
  },
  {
    id: 'minorPentatonic',
    name: 'minor pentatonic',
    intervals: [0, 3, 5, 7, 10],
    degrees: ['1', '♭3', '4', '5', '♭7'],
    parentOffset: 3,
  },
  {
    id: 'blues',
    name: 'blues',
    intervals: [0, 3, 5, 6, 7, 10],
    degrees: ['1', '♭3', '4', '♭5', '5', '♭7'],
    parentOffset: 3,
  },
  {
    id: 'majorBlues',
    name: 'major blues',
    intervals: [0, 2, 3, 4, 7, 9],
    degrees: ['1', '2', '♭3', '3', '5', '6'],
    parentOffset: 0,
  },
];

export function scaleOf(id: ScaleId): Scale {
  const found = SCALES.find((scale) => scale.id === id);
  if (!found) throw new RangeError(`unknown scale ${id}`);
  return found;
}

/** The pitch classes of `scale` on `tonic`. */
export function scalePitchClasses(scale: Scale, tonic: number): number[] {
  return scale.intervals.map((interval) => (tonic + interval) % 12);
}
