import { PPQ } from '@reprise/model';

/** A 64th note: shorter durations space like one. */
const SHORTEST = PPQ / 16;
/** Width of the shortest duration, and what each doubling of the duration adds, in staff spaces. */
const SHORTEST_WIDTH = 1;
const DOUBLING_WIDTH = 0.7;

/**
 * The natural width in px of a beat lasting `ticks`: logarithmic in the duration, as in
 * Gourlay's spacing, so a half note is wider than a quarter but nowhere near twice as wide.
 */
export function durationWidth(ticks: number, space: number): number {
  const doublings = Math.log2(Math.max(ticks, SHORTEST) / SHORTEST);
  return (SHORTEST_WIDTH + DOUBLING_WIDTH * doublings) * space;
}

/**
 * The width of the stretch from one onset to the next, `gap` ticks later, when the shortest beat
 * starting at the onset lasts `governing` ticks: that beat's natural width, scaled by how much
 * of it the gap covers, so an onset of another voice inside a long beat splits its width.
 */
export function segmentWidth(gap: number, governing: number, space: number): number {
  return (durationWidth(governing, space) * gap) / governing;
}

export interface Spring {
  natural: number;
  min: number;
}

/** Each spring at `factor` times its natural width, never below its minimum. */
export function stretch(springs: readonly Spring[], factor: number): number[] {
  return springs.map(({ natural, min }) => Math.max(min, natural * factor));
}
