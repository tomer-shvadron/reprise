import type { KeySignature } from '@reprise/model';

import { pitchHistogram } from './histogram';
import { DEFAULT_PROFILE_SET, bassCues, cueEvidence, rankKeys } from './key';
import { keyName, type KeyQuality } from './key-names';
import { profileSetOf } from './key-profiles';
import type { NoteTable } from './note-table';
import type { SongOutline } from './outline';
import { rowsByBar, rowsInBars, subTable } from './rows';
import { sectionSpans } from './sections';

/**
 * What a change of key costs per bar of window, in correlation units: the path pays this times
 * `WINDOW_BARS` for each change. It is about the 0.1 that separates a clear key from its relative
 * in `confidenceOf` (and a bit more), so noise between relative keys never pays for a change and
 * a modulation, whose new key leads by 0.3 or more over 8 bars, does.
 */
export const CHANGE_PENALTY = 0.15;
/** A change must hold for this many bars. */
export const MIN_CHANGE_BARS = 8;
/** And its key must correlate this much better than the main key over those bars. */
export const MIN_GAIN = 0.1;
/** Windows are this long, with a hop of `WINDOW_HOP`, where the file gives no shorter section. */
export const WINDOW_BARS = 8;
export const WINDOW_HOP = 4;
/** A section longer than this is cut into windows too, so a modulation inside it shows. */
export const LONG_SECTION_BARS = 16;
/** A boundary is searched this far either side of where the path put it. */
const REFINE_REACH = WINDOW_BARS;
/** And judged on at most this many bars of each neighbour. */
const REFINE_CONTEXT = 16;

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

/** 8-bar windows with a hop of 4 across `from` to `to`, the last one flush with the end. */
function slide(from: number, to: number): Window[] {
  const windows: Window[] = [];
  for (let start = from; ; start += WINDOW_HOP) {
    const end = Math.min(to, start + WINDOW_BARS - 1);
    windows.push({ from: Math.min(start, Math.max(from, end - WINDOW_BARS + 1)), to: end });
    if (end >= to) break;
  }
  return windows;
}

/**
 * The file's sections as windows when it has two or more (a section of up to 16 bars is one window,
 * a longer one is slid across like an unsectioned file), otherwise the whole song slid across.
 */
function windowsOf(outline: SongOutline): Window[] {
  const spans = sectionSpans(outline);
  if (spans.length < 2) return slide(0, outline.bars.length - 1);
  return spans.flatMap((span) =>
    span.toBar - span.fromBar + 1 > LONG_SECTION_BARS
      ? slide(span.fromBar, span.toBar)
      : [{ from: span.fromBar, to: span.toBar }],
  );
}

/**
 * The best path of one key per step: a hidden Markov model over the 24 keys whose emission is the
 * step's correlation with the key and whose transition costs `penalty` for any change of key (after
 * Temperley 2007, ch. 4, simplified). With an `anchor` the path starts and ends in that key, so
 * every excursion pays for leaving and for coming back, wherever it sits in the song: a chorus in
 * the middle costs what a last chorus does. A step with no notes correlates with nothing, so it keeps
 * the key before it.
 */
export function viterbi(
  emissions: readonly (readonly number[])[],
  penalty: number,
  anchor?: number,
): number[] {
  const n = emissions[0]?.length ?? 0;
  if (emissions.length === 0 || n === 0) return [];
  const away = (k: number): number => (anchor === undefined || k === anchor ? 0 : penalty);
  const back: number[][] = [];
  let score = (emissions[0] ?? []).map((value, k) => value - away(k));
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
  const last = (k: number): number => (score[k] ?? 0) - away(k);
  for (let k = 1; k < n; k++) if (last(k) > last(state)) state = k;
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
  'a fifth',
  'a minor sixth',
  'a major sixth',
  'a minor seventh',
  'a major seventh',
] as const;

/** How `other` sits against `main`: the relative or parallel key, or the interval up to its tonic. */
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
  return `up ${INTERVALS[up] ?? ''}`;
}

/** Index into the 24 keys of `rankKeys`'s own order: the tonic, then major before minor. */
const stateOf = (key: { tonic: number; quality: KeyQuality }): number =>
  key.tonic * 2 + (key.quality === 'minor' ? 1 : 0);

interface Run {
  from: number;
  to: number;
  state: number;
}

/**
 * Where the music moves to another key for at least `MIN_CHANGE_BARS`. `main` is the song's key;
 * a song with no key has no changes to report. Each bar takes the mean score of the windows that
 * hold it, a path anchored in the main key gives the stretches, and each boundary is then put on
 * the exact bar by trying the bars around it and keeping the split where the two keys fit best.
 */
export function keyChanges(
  table: NoteTable,
  outline: SongOutline,
  main: { tonic: number; quality: KeyQuality | 'none' } | undefined,
  fileKey?: KeySignature,
): KeyChange[] {
  const bars = outline.bars.length;
  if (!main || bars < MIN_CHANGE_BARS) return [];
  const mainKey = {
    tonic: main.tonic,
    quality: main.quality === 'minor' ? 'minor' : 'major',
  } as const;
  const mainState = stateOf(mainKey);
  const profiles = profileSetOf(DEFAULT_PROFILE_SET);
  const rowsOfBar = rowsByBar(table, bars);
  // The bass counts in a window as it does in the whole song (`detectKey`), or the main key, found
  // with it, would disagree with every window about the relative key.
  const scoresOf = (from: number, to: number, withCues = true): Map<number, number> => {
    const sub = subTable(table, rowsInBars(rowsOfBar, from, to));
    const cues = withCues ? bassCues(sub) : undefined;
    const scores = new Map<number, number>();
    for (const estimate of rankKeys(pitchHistogram(sub), profiles)) {
      scores.set(
        stateOf(estimate),
        estimate.correlation + (cues ? cueEvidence(cues, estimate.tonic) : 0),
      );
    }
    return scores;
  };

  const sums = Array.from({ length: bars }, () => new Array<number>(24).fill(0));
  const holds = new Array<number>(bars).fill(0);
  for (const window of windowsOf(outline)) {
    const scores = scoresOf(window.from, window.to);
    for (let bar = window.from; bar <= window.to; bar++) {
      holds[bar] = (holds[bar] ?? 0) + 1;
      const row = sums[bar];
      for (let state = 0; state < 24; state++) {
        if (row) row[state] = (row[state] ?? 0) + (scores.get(state) ?? 0);
      }
    }
  }
  const emissions = sums.map((row, bar) =>
    row.map((value) => value / Math.max(1, holds[bar] ?? 1)),
  );
  const path = viterbi(emissions, CHANGE_PENALTY * WINDOW_BARS, mainState);

  const runs: Run[] = [];
  path.forEach((state, bar) => {
    const last = runs[runs.length - 1];
    if (last?.state === state) last.to = bar;
    else runs.push({ from: bar, to: bar, state });
  });
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i];
    const b = runs[i + 1];
    if (!a || !b) continue;
    const boundary = b.from;
    let best = boundary;
    let bestFit = Number.NEGATIVE_INFINITY;
    const candidates: number[] = [];
    for (
      let s = Math.max(a.from + 1, boundary - REFINE_REACH);
      s <= Math.min(b.to, boundary + REFINE_REACH);
      s++
    ) {
      candidates.push(s);
    }
    candidates.sort((x, y) => Math.abs(x - boundary) - Math.abs(y - boundary));
    // A change point: each bar votes for the key of the left run or the right by how much better
    // that key fits the bar alone, and the split with the largest total of right votes after it
    // and left votes before it wins. A split is judged by whole bars, so it does not grow with the
    // length of either side and a side that borrows bars of the other key loses their votes.
    const votes = new Map<number, number>();
    const vote = (bar: number): number => {
      let known = votes.get(bar);
      if (known === undefined) {
        const scores = scoresOf(bar, bar, false);
        known = (scores.get(b.state) ?? 0) - (scores.get(a.state) ?? 0);
        votes.set(bar, known);
      }
      return known;
    };
    for (const split of candidates) {
      let fit = 0;
      for (let bar = Math.max(a.from, split - REFINE_CONTEXT); bar < split; bar++) fit -= vote(bar);
      for (let bar = split; bar <= Math.min(b.to, split + REFINE_CONTEXT - 1); bar++)
        fit += vote(bar);
      if (fit > bestFit + 1e-9) {
        bestFit = fit;
        best = split;
      }
    }
    a.to = best - 1;
    b.from = best;
  }

  const changes: KeyChange[] = [];
  for (const run of runs) {
    if (run.state === mainState || run.to - run.from + 1 < MIN_CHANGE_BARS) continue;
    const scores = scoresOf(run.from, run.to);
    const gain = (scores.get(run.state) ?? 0) - (scores.get(mainState) ?? 0);
    if (gain < MIN_GAIN) continue;
    const key = { tonic: run.state >> 1, quality: run.state & 1 ? 'minor' : 'major' } as const;
    changes.push({
      fromBar: run.from,
      toBar: run.to,
      tonic: key.tonic,
      quality: key.quality,
      name: keyName(key.tonic, key.quality, fileKey),
      relation: relationOf(mainKey, key),
      gain,
    });
  }
  return changes;
}
