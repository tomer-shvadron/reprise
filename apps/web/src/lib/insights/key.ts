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

interface BassNote {
  pc: number;
  bar: number;
  onset: number;
  metric: number;
  weight: number;
}

/** The lowest sounding note of every beat, in no particular order. */
function bassNotes(table: NoteTable): BassNote[] {
  const lowest = new Map<number, BassNote & { pitch: number }>();
  for (let i = 0; i < table.length; i++) {
    if ((table.flags[i] ?? 0) & NOTE_FLAG.dead) continue;
    const beat = table.beat[i] ?? 0;
    const pitch = table.pitch[i] ?? 0;
    const known = lowest.get(beat);
    if (known && known.pitch <= pitch) continue;
    lowest.set(beat, {
      pitch,
      pc: pitch % 12,
      bar: table.bar[i] ?? 0,
      onset: table.onset[i] ?? 0,
      metric: table.metric[i] ?? 2,
      weight: ((table.duration[i] ?? 0) / PPQ) * (table.passes[i] ?? 1),
    });
  }
  return [...lowest.values()];
}

/**
 * The pitch class the bass cues clearly favour: the last bass note (worth two), the first one, and
 * the bass note most often heard on a downbeat. `undefined` unless one candidate holds three of the four votes.
 */
export function tonicByCues(table: NoteTable): number | undefined {
  const bass = bassNotes(table);
  if (bass.length === 0) return undefined;
  const byTime = [...bass].sort((a, b) => a.bar - b.bar || a.onset - b.onset);
  const first = byTime[0];
  const last = byTime[byTime.length - 1];
  const downbeats = new Array<number>(12).fill(0);
  for (const note of bass)
    if (note.metric === 0) downbeats[note.pc] = (downbeats[note.pc] ?? 0) + note.weight;
  const top = Math.max(...downbeats);
  const heaviest = downbeats.flatMap((weight, pc) => (weight === top ? [pc] : []));
  // A tie is no evidence: the lowest pitch class must not win it.
  const most = heaviest.length === 1 ? heaviest[0] : undefined;
  // The last note counts double: a piece ends where it is at home, while it may begin anywhere.
  const cues: [number | undefined, number][] = [
    [last?.pc, 2],
    [first?.pc, 1],
    [top > 0 ? most : undefined, 1],
  ];
  const votes = new Map<number, number>();
  for (const [pc, weight] of cues)
    if (pc !== undefined) votes.set(pc, (votes.get(pc) ?? 0) + weight);
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  const [winner, runnerUp] = ranked;
  // Clear means three of the four votes, so the last note alone never moves the tonic.
  return winner && winner[1] >= 3 && winner[1] > (runnerUp?.[1] ?? 0) ? winner[0] : undefined;
}

const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];

/** The pitch classes of the key's collection: its major scale, or its natural minor scale. */
const collectionOf = (key: KeyEstimate): Set<number> =>
  new Set(
    MAJOR_DEGREES.map((degree) => (key.tonic + degree + (key.quality === 'minor' ? 3 : 0)) % 12),
  );

export type KeyResult =
  | { found: false; reason: 'not-enough-notes' }
  | {
      found: true;
      tonic: number;
      /** `none` for a riff without a third: the tonic holds, the mode is not guessed. */
      quality: KeyQuality | 'none';
      confidence: Confidence;
      /** The best correlation, before the tonic cues. */
      correlation: number;
      /** The next best reading, which the card names so the choice is honest. */
      runnerUp: KeyEstimate;
      /** The tonic moved from the correlation's pick to another degree of the same collection. */
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

/** How many notes the key can rest on: dead notes carry no evidence. */
const sounding = (table: NoteTable): number => {
  let count = 0;
  for (let i = 0; i < table.length; i++) if (!((table.flags[i] ?? 0) & NOTE_FLAG.dead)) count++;
  return count;
};

export function detectKey(table: NoteTable, options: DetectOptions = {}): KeyResult {
  if (sounding(table) < MIN_NOTES) return { found: false, reason: 'not-enough-notes' };
  const histogram = pitchHistogram(table, options.factors);
  if (sumOf(histogram) <= 0) return { found: false, reason: 'not-enough-notes' };
  const profiles = profileSetOf(options.profiles ?? DEFAULT_PROFILE_SET);
  const ranked = rankKeys(histogram, profiles);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || !second) return { found: false, reason: 'not-enough-notes' };

  let tonic = best.tonic;
  let quality: KeyQuality | 'none' = best.quality;
  let confidence = confidenceOf(best.correlation, second.correlation);
  const cue = options.cues === false ? undefined : tonicByCues(table);
  const movedByCues = cue !== undefined && cue !== tonic && collectionOf(best).has(cue);
  if (movedByCues) {
    tonic = cue;
    // A tonic found from its cues is read from the collection, never surer than "medium".
    if (confidence === 'high') confidence = 'medium';
  }

  const total = sumOf(histogram);
  const minorThird = (histogram[(tonic + 3) % 12] ?? 0) / total;
  const majorThird = (histogram[(tonic + 4) % 12] ?? 0) / total;
  if (minorThird < NO_THIRD_SHARE && majorThird < NO_THIRD_SHARE) quality = 'none';
  else if (movedByCues) quality = majorThird >= minorThird ? 'major' : 'minor';

  const signatureQuality = quality === 'minor' ? 'minor' : 'major';
  const signature = keySignatureOf(tonic, signatureQuality, options.fileKey);
  const result: KeyResult = {
    found: true,
    tonic,
    quality,
    confidence,
    correlation: best.correlation,
    runnerUp: movedByCues ? best : second,
    movedByCues,
    name: keyName(tonic, quality, options.fileKey),
    signature,
    scale: fitScale(histogram, tonic),
    histogram,
  };
  if (options.fileKey) result.agreesWithFile = options.fileKey.fifths === signature.fifths;
  return result;
}
