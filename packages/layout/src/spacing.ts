import { PPQ } from '@reprise/model';

/** A 64th note: shorter durations space like one. */
const SHORTEST = PPQ / 16;
/** Width of the shortest duration, and what each doubling of the duration adds, in staff spaces. */
const SHORTEST_WIDTH = 1;
const DOUBLING_WIDTH = 0.7;
/** A quarter's width on both curves, in staff spaces, so they meet there. */
const QUARTER_WIDTH = 3.8;
/** How a longer note's width grows with its length beyond a quarter: a power curve, not a log. */
const LONG_EXPONENT = 0.85;

/**
 * The natural width in px of a beat lasting `ticks`. Up to a quarter it is logarithmic in the
 * duration, as in Gourlay's spacing; beyond, it follows Guitar Pro's feel, `QUARTER_WIDTH × q^0.85`
 * for q quarters, so a half is 6.8 spaces and a whole 12.3 where the log would give 4.5 and 5.2.
 */
export function durationWidth(ticks: number, space: number): number {
  if (ticks > PPQ) return QUARTER_WIDTH * (ticks / PPQ) ** LONG_EXPONENT * space;
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
  /**
   * The part of `min` that `squeeze` leaves alone: what a bar's last onset draws right of itself
   * (a second voice shifted off a first one included), which squeezing the spring would push
   * past the bar's end and the system's.
   */
  rigid?: number;
}

/** A spring's minimum width in a bar squeezed by `squeeze`: only the part above `rigid` shrinks. */
export function squeezedMin({ min, rigid = 0 }: Spring, squeeze: number): number {
  return squeeze >= 1 ? min : rigid + Math.max(0, min - rigid) * squeeze;
}

/**
 * Each spring at `factor` times its natural width, never below its minimum scaled by `squeeze` (bar the rigid part),
 * which is below 1 only in a bar whose minimums alone overflow its line.
 */
export function stretch(springs: readonly Spring[], factor: number, squeeze = 1): number[] {
  return springs.map((spring) => Math.max(squeezedMin(spring, squeeze), spring.natural * factor));
}
