import { PPQ, barTicks, beatTicks, playedBarTicks, type Score } from '@reprise/model';

const TICK_EPSILON = 1e-6;
/** The engine's gap between neighbouring onsets' extents (`measure.ts`), in staff spaces. */
const ONSET_GAP = 0.3;
/** The engine's natural width of a quarter note, where Guitar Pro's feel and Gourlay's agree. */
const QUARTER_WIDTH = 3.8;
/** How a longer note's width grows with its length beyond a quarter: a power curve, not a log. */
const LONG_EXPONENT = 0.85;

/**
 * The width Guitar Pro gives a beat of `ticks`, in staff spaces, where it exceeds the engine's
 * logarithmic spacing: the same as the engine up to a quarter, then `QUARTER_WIDTH × (q)^0.85` for
 * q quarters, so a half is 6.8 spaces and a whole 12.3 where the engine gives 4.5 and 5.2.
 */
export function feelWidth(ticks: number): number {
  return ticks <= PPQ ? 0 : QUARTER_WIDTH * (ticks / PPQ) ** LONG_EXPONENT;
}

interface ColumnOnset {
  tick: number;
  governing: number;
}

const columns = new WeakMap<Score, Map<number, { onsets: ColumnOnset[]; end: number }>>();

/**
 * Every onset of every track at a bar index, with the shortest beat starting there, as the engine
 * merges them. All tracks rather than the visible ones, which the module cannot see: a hidden
 * track's onsets only make the floor smaller, never push a visible beat apart.
 */
function column(score: Score, barIndex: number): { onsets: ColumnOnset[]; end: number } {
  let byBar = columns.get(score);
  if (!byBar) {
    byBar = new Map();
    columns.set(score, byBar);
  }
  const cached = byBar.get(barIndex);
  if (cached) return cached;
  const raw: ColumnOnset[] = [];
  for (const track of score.tracks) {
    for (const voice of track.bars[barIndex]?.voices ?? []) {
      let tick = 0;
      for (const beat of voice.beats) {
        const ticks = beatTicks(beat);
        raw.push({ tick, governing: ticks });
        tick += ticks;
      }
    }
  }
  raw.sort((a, b) => a.tick - b.tick || a.governing - b.governing);
  const onsets: ColumnOnset[] = [];
  for (const onset of raw) {
    const last = onsets.at(-1);
    if (last && onset.tick - last.tick < TICK_EPSILON)
      last.governing = Math.min(last.governing, onset.governing);
    else onsets.push({ ...onset });
  }
  const masterBar = score.masterBars[barIndex];
  const last = onsets.at(-1);
  const contentEnd = last ? last.tick + last.governing : 0;
  const written = masterBar ? barTicks(masterBar) : 0;
  const end = masterBar?.anacrusis
    ? Math.max(playedBarTicks(score, barIndex), contentEnd)
    : Math.max(written, contentEnd);
  const result = { onsets, end };
  byBar.set(barIndex, result);
  return result;
}

/**
 * The right extent an onset at `tick` needs for the segment after it to be as wide as
 * `feelWidth` says, given the left extent `nextLeft` of the onset that follows it, in px. The
 * engine only offers minimums to a module, so this is how a module widens long notes.
 */
export function feelRight(
  score: Score,
  barIndex: number,
  tick: number,
  nextLeft: (tick: number) => number,
  space: number,
): number {
  const { onsets, end } = column(score, barIndex);
  const i = onsets.findIndex((onset) => Math.abs(onset.tick - tick) < TICK_EPSILON);
  const onset = onsets[i];
  if (!onset) return 0;
  const feel = feelWidth(onset.governing);
  if (feel === 0) return 0;
  const next = onsets[i + 1];
  const gap = (next?.tick ?? end) - onset.tick;
  const width = (feel * space * gap) / onset.governing;
  return width - ONSET_GAP * space - (next ? nextLeft(next.tick) : 0);
}
