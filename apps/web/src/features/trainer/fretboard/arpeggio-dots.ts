import { chordDegrees, parseChord, parseChordName } from '@/lib/chords';
import { scaleOf } from '@/lib/insights';

import type { BoardShape } from './fretboard-model';
import { modulo, neckTones, spellByDegree } from './neck-tones';
import type { ScaleSpec } from './scale-dots';

/** A chord as the overlay draws it: its tones, spelled from its own root. */
export interface Arpeggio {
  /** As the source wrote it (`G/F♯`), for the chip. */
  name: string;
  root: number;
  /** `B♭`, as the name spells the root. */
  rootName: string;
  intervals: readonly number[];
  /** `R`, `♭3`, `5`, `♭7`; parallel to `intervals`. */
  degrees: string[];
  notes: string[];
}

/** One position on the neck that sounds a chord tone. */
export interface ArpeggioDot {
  string: number;
  absolute: number;
  degree: string;
  name: string;
  root: boolean;
  /** Set only when a scale was given: the tone is not one of its notes. */
  outsideScale?: true;
}

/**
 * The chord a name stands for, or `undefined` when it is not a chord or its quality is unknown.
 * A slash bass is ignored: the overlay draws the chord's own tones, and a bass that is not one of
 * them is not added.
 */
export function arpeggioOf(name: string): Arpeggio | undefined {
  const spec = parseChord(name);
  const parsed = parseChordName(name);
  if (!spec || !parsed) return undefined;
  const degrees = chordDegrees(spec.quality);
  return {
    name,
    root: spec.root,
    rootName: parsed.rootText,
    intervals: spec.quality.intervals,
    degrees,
    notes: spellByDegree(parsed.rootText, spec.quality.intervals, degrees),
  };
}

/** The accessible name of the layer: `Am7 chord tones: A R, C ♭3, E 5, G ♭7`. */
export function arpeggioLabel(arpeggio: Arpeggio): string {
  const tones = arpeggio.notes.map((note, at) => `${note} ${arpeggio.degrees[at] ?? ''}`);
  return `${arpeggio.name} chord tones: ${tones.join(', ')}`;
}

/**
 * Every position that sounds a tone of the chord, on the same neck rules as the scale overlay
 * (capo, banjo drone, any string count, the dot cap). With `scale`, a tone outside the scale is
 * flagged.
 */
export function arpeggioDots(
  board: BoardShape,
  tuning: readonly number[],
  arpeggio: Arpeggio,
  scale?: Pick<ScaleSpec, 'tonic' | 'scaleId'>,
): ArpeggioDot[] {
  const inScale = scale
    ? new Set(
        scaleOf(scale.scaleId).intervals.map((interval) => modulo(scale.tonic + interval, 12)),
      )
    : undefined;
  return neckTones(board, tuning, arpeggio.root, arpeggio.intervals).map(
    ({ string, absolute, at }) => {
      const interval = arpeggio.intervals[at] ?? 0;
      return {
        string,
        absolute,
        degree: arpeggio.degrees[at] ?? '',
        name: arpeggio.notes[at] ?? '',
        root: at === 0,
        ...(inScale && !inScale.has(modulo(arpeggio.root + interval, 12))
          ? { outsideScale: true as const }
          : {}),
      };
    },
  );
}
