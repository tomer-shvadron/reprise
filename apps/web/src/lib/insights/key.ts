import { PPQ, type KeySignature } from '@reprise/model';

import { pitchHistogram, sumOf, type Histogram, type HistogramOptions } from './histogram';
import { keyName, keySignatureOf, type KeyQuality } from './key-names';
import { profileSetOf, type Profile, type ProfileSet } from './key-profiles';
import { NOTE_FLAG, type NoteTable } from './note-table';
import { fitScale, type ScaleFit } from './scale-fit';

/** Fewer sounding notes than this is not enough to name a key. */
export const MIN_NOTES = 16;
/** Neither third carrying this share of the weight means a power-chord riff: no third. */
export const NO_THIRD_SHARE = 0.02;
/** The profile set the accuracy table in `key-accuracy.test.ts` picked as the default. */
export const DEFAULT_PROFILE_SET: ProfileSet['id'] = 'krumhanslKessler';

/** The thresholds of `confidenceOf`, set by the corpus. */
export const CONFIDENCE = { highCorrelation: 0.8, highGap: 0.1, mediumGap: 0.04 } as const;

export interface KeyEstimate {
  tonic: number;
  quality: KeyQuality;
  /** Pearson correlation of the histogram with the key's profile, -1 to 1. */
  correlation: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let cross = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    cross += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denominator = Math.sqrt(varA * varB);
  return denominator === 0 ? 0 : cross / denominator;
}

const rotated = (profile: Profile, tonic: number): number[] =>
  Array.from({ length: 12 }, (_, pc) => profile[(pc - tonic + 12) % 12] ?? 0);

/** All 24 keys, best correlation first (Krumhansl–Schmuckler). */
export function rankKeys(histogram: Histogram, profiles: ProfileSet): KeyEstimate[] {
  const keys: KeyEstimate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    keys.push({
      tonic,
      quality: 'major',
      correlation: pearson(histogram, rotated(profiles.major, tonic)),
    });
    keys.push({
      tonic,
      quality: 'minor',
      correlation: pearson(histogram, rotated(profiles.minor, tonic)),
    });
  }
  return keys.sort((a, b) => b.correlation - a.correlation);
}

/**
 * "High" when the best key correlates strongly and clears the runner-up (often the relative or
 * parallel key) by a margin, "medium" when only the margin is moderate, "low" otherwise.
 */
export function confidenceOf(best: number, runnerUp: number): Confidence {
  const gap = best - runnerUp;
  if (best >= CONFIDENCE.highCorrelation && gap >= CONFIDENCE.highGap) return 'high';
  if (gap >= CONFIDENCE.mediumGap) return 'medium';
  return 'low';
}

/** One moment where a note starts, with the lowest pitch sounding then in any track. */
interface Sonority {
  bar: number;
  onset: number;
  pc: number;
  /** Quarter notes until the next onset in the bar, times the bar's passes. */
  weight: number;
}

/**
 * The bass line across all tracks: at each onset the lowest pitch sounding, held notes included,
 * so a melody's fill over a held bass note never counts as the bass. Dead notes and grace notes
 * start no sonority; a tied continuation is not an onset but still sounds.
 */
export function sonorities(table: NoteTable): Sonority[] {
  const byBar = new Map<number, number[]>();
  for (let i = 0; i < table.length; i++) {
    if ((table.flags[i] ?? 0) & NOTE_FLAG.dead) continue;
    const bar = table.bar[i] ?? 0;
    const rows = byBar.get(bar);
    if (rows) rows.push(i);
    else byBar.set(bar, [i]);
  }
  const result: Sonority[] = [];
  for (const [bar, rows] of [...byBar].sort((a, b) => a[0] - b[0])) {
    const starts = [
      ...new Set(
        rows
          .filter((i) => !((table.flags[i] ?? 0) & (NOTE_FLAG.tie | NOTE_FLAG.grace)))
          .map((i) => table.onset[i] ?? 0),
      ),
    ].sort((a, b) => a - b);
    const barEnd = Math.max(...rows.map((i) => (table.onset[i] ?? 0) + (table.duration[i] ?? 0)));
    starts.forEach((onset, index) => {
      let lowest = Number.POSITIVE_INFINITY;
      for (const i of rows) {
        if ((table.flags[i] ?? 0) & NOTE_FLAG.grace) continue;
        const from = table.onset[i] ?? 0;
        if (from <= onset + 1e-6 && onset < from + (table.duration[i] ?? 0) - 1e-6) {
          lowest = Math.min(lowest, table.pitch[i] ?? 0);
        }
      }
      if (!Number.isFinite(lowest)) return;
      const first = rows.find((i) => (table.onset[i] ?? 0) === onset);
      const passes = first === undefined ? 1 : (table.passes[first] ?? 1);
      result.push({
        bar,
        onset,
        pc: lowest % 12,
        weight: (((starts[index + 1] ?? barEnd) - onset) / PPQ) * passes,
      });
    });
  }
  return result;
}

/**
 * The weights of the bass evidence, added to a key's correlation. They are set once, from the
 * scale of the correlation: the right key and its closest rival (the relative or the parallel key)
 * usually differ by 0.02 to 0.15 in correlation, so a bass that agrees on all three cues (total
 * 0.32) can settle a close call or a modal vamp, while a key that correlates 0.3 or more below the
 * leader never wins on the bass alone. The downbeat share carries most of it because it is a
 * proportion of the whole piece; the first and the last note are single, fragile observations
 * (fade-outs, loops cut short), so each is small and neither can decide anything alone.
 */
export const CUE_WEIGHTS = { downbeat: 0.2, last: 0.06, first: 0.06 } as const;

export interface BassCues {
  first: number | undefined;
  last: number | undefined;
  /** The share of downbeat bass weight on each pitch class; sums to 1, or all zero. */
  downbeat: number[];
}

export function bassCues(table: NoteTable): BassCues {
  const line = sonorities(table);
  const downbeat = new Array<number>(12).fill(0);
  for (const s of line) if (s.onset < 1e-6) downbeat[s.pc] = (downbeat[s.pc] ?? 0) + s.weight;
  const total = downbeat.reduce((a, b) => a + b, 0);
  return {
    first: line[0]?.pc,
    last: line[line.length - 1]?.pc,
    downbeat: total > 0 ? downbeat.map((w) => w / total) : downbeat,
  };
}

/** How much the bass favours `tonic` as the tonic, 0 to the sum of `CUE_WEIGHTS`. */
export function cueEvidence(cues: BassCues, tonic: number): number {
  return (
    CUE_WEIGHTS.downbeat * (cues.downbeat[tonic] ?? 0) +
    (cues.first === tonic ? CUE_WEIGHTS.first : 0) +
    (cues.last === tonic ? CUE_WEIGHTS.last : 0)
  );
}

export type KeyResult =
  | { found: false; reason: 'not-enough-notes' }
  | {
      found: true;
      tonic: number;
      /** `none` for a riff without a third: the tonic holds, the mode is not guessed. */
      quality: KeyQuality | 'none';
      confidence: Confidence;
      /** The winner's correlation with its profile, without the bass evidence. */
      correlation: number;
      /** The next best reading, which the card names so the choice is honest. */
      runnerUp: KeyEstimate;
      /** The bass evidence changed the winner from the correlation's own pick. */
      movedByCues: boolean;
      /** E.g. `A minor`. */
      name: string;
      /** The signature the key spells with. */
      signature: KeySignature;
      /** The file's own key signature names this key or its relative. */
      agreesWithFile?: boolean;
      scale: ScaleFit | undefined;
      histogram: Histogram;
    };

export interface DetectOptions {
  profiles?: ProfileSet['id'];
  factors?: Partial<HistogramOptions>;
  /** Turn the tonic cues off to see the correlation's own pick; the accuracy table uses it. Default on. */
  cues?: boolean;
  /** The key signature of the first master bar: evidence for spelling only, never a prior. */
  fileKey?: KeySignature;
}

/** How many notes the key can rest on: onsets only, so a tie, a grace note or a dead note adds none. */
export const onsetCount = (table: NoteTable): number => {
  let count = 0;
  for (let i = 0; i < table.length; i++) {
    if (!((table.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace))) count++;
  }
  return count;
};

export function detectKey(table: NoteTable, options: DetectOptions = {}): KeyResult {
  if (onsetCount(table) < MIN_NOTES) return { found: false, reason: 'not-enough-notes' };
  const histogram = pitchHistogram(table, options.factors);
  if (sumOf(histogram) <= 0) return { found: false, reason: 'not-enough-notes' };
  const profiles = profileSetOf(options.profiles ?? DEFAULT_PROFILE_SET);
  const byCorrelation = rankKeys(histogram, profiles);
  const cues = options.cues === false ? undefined : bassCues(table);
  // The bass is evidence added to each key's score, never an override of the correlation.
  const scored = byCorrelation
    .map((key) => ({ key, score: key.correlation + (cues ? cueEvidence(cues, key.tonic) : 0) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || !second) return { found: false, reason: 'not-enough-notes' };

  const { tonic } = best.key;
  let quality: KeyQuality | 'none' = best.key.quality;
  const total = sumOf(histogram);
  const minorThird = (histogram[(tonic + 3) % 12] ?? 0) / total;
  const majorThird = (histogram[(tonic + 4) % 12] ?? 0) / total;
  if (minorThird < NO_THIRD_SHARE && majorThird < NO_THIRD_SHARE) quality = 'none';
  // A profile can name a mode whose third the music hardly plays (a tonic found by its bass in a
  // modal tune); the thirds the notes actually carry decide, when one is twice the other.
  else if (quality === 'major' && minorThird > 2 * majorThird) quality = 'minor';
  else if (quality === 'minor' && majorThird > 2 * minorThird) quality = 'major';

  const signature = keySignatureOf(tonic, quality === 'minor' ? 'minor' : 'major', options.fileKey);
  const result: KeyResult = {
    found: true,
    tonic,
    quality,
    confidence: confidenceOf(
      best.key.correlation,
      best.key.correlation - (best.score - second.score),
    ),
    correlation: best.key.correlation,
    runnerUp: second.key,
    movedByCues: best.key !== byCorrelation[0],
    name: keyName(tonic, quality, options.fileKey),
    signature,
    scale: fitScale(histogram, tonic, quality),
    histogram,
  };
  if (options.fileKey) result.agreesWithFile = options.fileKey.fifths === signature.fifths;
  return result;
}
