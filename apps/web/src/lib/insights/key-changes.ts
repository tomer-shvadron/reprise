import type { KeySignature } from '@reprise/model';

import { pitchHistogram } from './histogram';
import { DEFAULT_PROFILE_SET, bassCues, cueEvidence, rankKeys } from './key';
import { keyName, type KeyQuality } from './key-names';
import { profileSetOf } from './key-profiles';
import type { NoteTable } from './note-table';
import type { SongOutline } from './outline';
import { rowsByBar, rowsInBars, subTable } from './rows';
import { sectionSpans } from './sections';

/** The cost of changing key between two windows, in correlation units (see `viterbi`). */
export const CHANGE_PENALTY = 0.3;
/** A change must hold for this many bars. */
export const MIN_CHANGE_BARS = 8;
/** And its key must correlate this much better than the main key over those bars. */
export const MIN_GAIN = 0.1;
/** Windows when the file has fewer than two sections. */
export const WINDOW_BARS = 8;
export const WINDOW_HOP = 4;

export interface KeyChange {
  /** First and last master bar, inclusive. */
  fromBar: number;
  toBar: number;
  tonic: number;
  quality: KeyQuality;
  name: string;
  /** Against the main key: `up a whole step`, `relative major`, `parallel minor`. */
  relation: string;
  /** How much better the new key correlates than the main key over the span. */
  gain: number;
}

interface Window {
  from: number;
  to: number;
}

function windowsOf(outline: SongOutline): Window[] {
  const spans = sectionSpans(outline);
  if (spans.length >= 2) return spans.map((span) => ({ from: span.fromBar, to: span.toBar }));
  const windows: Window[] = [];
  const bars = outline.bars.length;
  for (let from = 0; from < bars; from += WINDOW_HOP) {
    windows.push({ from, to: Math.min(bars - 1, from + WINDOW_BARS - 1) });
    if (from + WINDOW_BARS >= bars) break;
  }
  return windows;
}

/**
 * The best path through the windows, one key each: a hidden Markov model over the 24 keys whose
 * emission is the window's correlation with the key and whose transition costs `CHANGE_PENALTY`
 * for any change of key (after Temperley 2007, ch. 4, simplified). The penalty is about twice the
 * 0.1 that separates a clear key from its relative in `confidenceOf`, so noise between the
 * relative keys never pays for a change and a modulation, whose new key leads by 0.3 or more,
 * does. A window with no notes correlates with nothing, so it keeps the key before it.
 */
export function viterbi(emissions: readonly (readonly number[])[], penalty: number): number[] {
  const n = emissions[0]?.length ?? 0;
  if (emissions.length === 0 || n === 0) return [];
  const back: number[][] = [];
  let score = [...(emissions[0] ?? [])];
  for (let t = 1; t < emissions.length; t++) {
    const next = new Array<number>(n).fill(0);
    const from = new Array<number>(n).fill(0);
    let bestPrevious = 0;
    for (let j = 1; j < n; j++) if ((score[j] ?? 0) > (score[bestPrevious] ?? 0)) bestPrevious = j;
    for (let k = 0; k < n; k++) {
      const stay = score[k] ?? 0;
      const move = (score[bestPrevious] ?? 0) - penalty;
      const useStay = stay >= move;
      next[k] = (useStay ? stay : move) + (emissions[t]?.[k] ?? 0);
      from[k] = useStay ? k : bestPrevious;
    }
    back.push(from);
    score = next;
  }
  let state = 0;
  for (let k = 1; k < n; k++) if ((score[k] ?? 0) > (score[state] ?? 0)) state = k;
  const path = new Array<number>(emissions.length).fill(0);
  for (let t = emissions.length - 1; t >= 0; t--) {
    path[t] = state;
    state = back[t - 1]?.[state] ?? state;
  }
  return path;
}

const INTERVALS = [
  '',
  'a half step',
  'a whole step',
  'a minor third',
  'a major third',
  'a fourth',
  'a tritone',
] as const;

/** How `other` sits against `main`: the relative or parallel key, or the step between the tonics. */
export function relationOf(
  main: { tonic: number; quality: KeyQuality },
  other: { tonic: number; quality: KeyQuality },
): string {
  const up = (other.tonic - main.tonic + 12) % 12;
  if (main.quality !== other.quality) {
    if (up === 0) return `parallel ${other.quality}`;
    if (main.quality === 'major' && up === 9) return 'relative minor';
    if (main.quality === 'minor' && up === 3) return 'relative major';
  }
  const steps = up <= 6 ? up : 12 - up;
  return `${up <= 6 ? 'up' : 'down'} ${INTERVALS[steps] ?? ''}`;
}

/** Index into the 24 keys of `rankKeys`'s own order: the tonic, then major before minor. */
const stateOf = (key: { tonic: number; quality: KeyQuality }): number =>
  key.tonic * 2 + (key.quality === 'minor' ? 1 : 0);

/**
 * Where the music moves to another key for at least `MIN_CHANGE_BARS`. `main` is the song's key;
 * a song with no key has no changes to report.
 */
export function keyChanges(
  table: NoteTable,
  outline: SongOutline,
  main: { tonic: number; quality: KeyQuality | 'none' } | undefined,
  fileKey?: KeySignature,
): KeyChange[] {
  if (!main || outline.bars.length < MIN_CHANGE_BARS) return [];
  const mainKey = {
    tonic: main.tonic,
    quality: main.quality === 'minor' ? 'minor' : 'major',
  } as const;
  const profiles = profileSetOf(DEFAULT_PROFILE_SET);
  const bars = rowsByBar(table, outline.bars.length);
  const windows = windowsOf(outline);
  // The bass counts in a window as it does in the whole song (`detectKey`), or the main key, found
  // with it, would disagree with every window about the relative key.
  const scoresOf = (rows: readonly number[]): Map<number, number> => {
    const sub = subTable(table, rows);
    const cues = bassCues(sub);
    const scores = new Map<number, number>();
    for (const estimate of rankKeys(pitchHistogram(sub), profiles)) {
      scores.set(stateOf(estimate), estimate.correlation + cueEvidence(cues, estimate.tonic));
    }
    return scores;
  };
  const emissions = windows.map((window) => {
    const scores = scoresOf(rowsInBars(bars, window.from, window.to));
    return Array.from({ length: 24 }, (_, state) => scores.get(state) ?? 0);
  });
  const path = viterbi(emissions, CHANGE_PENALTY);

  // Each bar takes the key of the window that holds it and is centred nearest to it (the earlier on a tie).
  const barState = outline.bars.map((_, bar) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    windows.forEach((window, index) => {
      if (bar < window.from || bar > window.to) return;
      const distance = Math.abs(bar - (window.from + window.to) / 2);
      if (distance < bestDistance - 1e-9) {
        best = index;
        bestDistance = distance;
      }
    });
    return path[best] ?? stateOf(mainKey);
  });

  const changes: KeyChange[] = [];
  let from = 0;
  for (let bar = 1; bar <= barState.length; bar++) {
    if (bar < barState.length && barState[bar] === barState[from]) continue;
    const state = barState[from] ?? 0;
    const key = { tonic: state >> 1, quality: state & 1 ? 'minor' : 'major' } as const;
    const length = bar - from;
    if (state !== stateOf(mainKey) && length >= MIN_CHANGE_BARS) {
      const scores = scoresOf(rowsInBars(bars, from, bar - 1));
      const gain = (scores.get(state) ?? 0) - (scores.get(stateOf(mainKey)) ?? 0);
      if (gain >= MIN_GAIN) {
        changes.push({
          fromBar: from,
          toBar: bar - 1,
          tonic: key.tonic,
          quality: key.quality,
          name: keyName(key.tonic, key.quality, fileKey),
          relation: relationOf(mainKey, key),
          gain,
        });
      }
    }
    from = bar;
  }
  return changes;
}
