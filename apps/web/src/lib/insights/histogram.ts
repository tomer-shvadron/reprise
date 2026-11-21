import { PPQ } from '@reprise/model';

import { METRIC, NOTE_FLAG, type NoteTable } from './note-table';

/** A weight per pitch class, C to B. */
export type Histogram = number[];

/**
 * The factors that turn a note into evidence for a key. Each can be switched off, which is how
 * `key-accuracy.test.ts` shows that every factor earns its place.
 */
export interface HistogramOptions {
  /** Weigh a note by its length; off, every note counts once. Krumhansl 1990, ch. 4. */
  duration: boolean;
  /** Notes on strong beats count more. Temperley 2007. */
  metric: boolean;
  /** The lowest note of each beat counts more. */
  bass: boolean;
  /** Multiply by how often playback passes the bar, so a repeated chorus counts as often as it is heard. */
  passes: boolean;
  /** Normalise each track before summing, so a dense lead does not outvote the bass. */
  normaliseTracks: boolean;
}

/** Every factor on, the top row of the accuracy table. */
export const ALL_FACTORS: HistogramOptions = {
  duration: true,
  metric: true,
  bass: true,
  passes: true,
  normaliseTracks: true,
};

/**
 * What `detectKey` uses. The metric accent is off: on the corpus it did not raise the exact
 * accuracy of any profile set (see `key-accuracy.test.ts`), so it has not earned its place.
 */
export const DEFAULT_FACTORS: HistogramOptions = { ...ALL_FACTORS, metric: false };

/** Indexed by `METRIC`: the downbeat, another beat, off the beat. */
export const METRIC_FACTOR = [1.5, 1.25, 1] as const;
export const BASS_FACTOR = 1.5;
export const GHOST_FACTOR = 0.5;

/**
 * The lowest pitch of every beat, by beat index. A table keeps the notes of a beat adjacent, so
 * one pass over the rows finds it.
 */
function lowestByBeat(table: NoteTable): Map<number, number> {
  const lowest = new Map<number, number>();
  for (let i = 0; i < table.length; i++) {
    if ((table.flags[i] ?? 0) & NOTE_FLAG.dead) continue;
    const beat = table.beat[i] ?? 0;
    const pitch = table.pitch[i] ?? 0;
    const known = lowest.get(beat);
    if (known === undefined || pitch < known) lowest.set(beat, pitch);
  }
  return lowest;
}

/** The weight of a note in quarter notes before the factors; a dead note has none. */
function weightOf(table: NoteTable, i: number, options: HistogramOptions): number {
  const flags = table.flags[i] ?? 0;
  if (flags & NOTE_FLAG.dead) return 0;
  let weight = options.duration ? (table.duration[i] ?? 0) / PPQ : 1;
  if (options.passes) weight *= table.passes[i] ?? 1;
  if (options.metric) weight *= METRIC_FACTOR[table.metric[i] ?? METRIC.offbeat] ?? 1;
  if (flags & NOTE_FLAG.ghost) weight *= GHOST_FACTOR;
  return weight;
}

export function pitchHistogram(
  table: NoteTable,
  options: Partial<HistogramOptions> = {},
): Histogram {
  const factors = { ...DEFAULT_FACTORS, ...options };
  const lowest = factors.bass ? lowestByBeat(table) : undefined;
  const perTrack = new Map<number, Histogram>();
  for (let i = 0; i < table.length; i++) {
    let weight = weightOf(table, i, factors);
    if (weight === 0) continue;
    const pitch = table.pitch[i] ?? 0;
    if (lowest && lowest.get(table.beat[i] ?? 0) === pitch) weight *= BASS_FACTOR;
    const trackIndex = factors.normaliseTracks ? (table.track[i] ?? 0) : 0;
    let bins = perTrack.get(trackIndex);
    if (!bins) perTrack.set(trackIndex, (bins = new Array<number>(12).fill(0)));
    bins[pitch % 12] = (bins[pitch % 12] ?? 0) + weight;
  }
  const total = new Array<number>(12).fill(0);
  for (const bins of perTrack.values()) {
    const sum = bins.reduce((a, b) => a + b, 0);
    if (sum === 0) continue;
    // Without normalisation there is one bin set, which stays in its own units.
    const scale = factors.normaliseTracks ? 1 / sum : 1;
    bins.forEach((value, pc) => (total[pc] = (total[pc] ?? 0) + value * scale));
  }
  return total;
}

export const sumOf = (histogram: Histogram): number => histogram.reduce((a, b) => a + b, 0);
