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
   * The part of `min` that `squeeze` leaves alone, so what the onsets draw right of themselves
   * (a second voice shifted off a first one included) stays inside the bar. The bar's springs
   * share the widest such extent as suffix maxima: the springs from an onset to the bar's end
   * always hold at least that onset's extent.
   */
  rigid?: number;
}

/**
 * A spring's minimum width in a bar squeezed by `squeeze`: only the part above `rigid` shrinks.
 * `rigidScale` is below 1 only when the rigid parts alone overflow the line.
 */
export function squeezedMin({ min, rigid = 0 }: Spring, squeeze: number, rigidScale = 1): number {
  return squeeze >= 1 ? min : rigid * rigidScale + Math.max(0, min - rigid) * squeeze;
}

/**
 * Each spring at `factor` times its natural width, never below its minimum, which `squeeze` and
 * `rigidScale` shrink only in a bar whose minimums alone overflow its line.
 */
export function stretch(
  springs: readonly Spring[],
  factor: number,
  squeeze = 1,
  rigidScale = 1,
): number[] {
  return springs.map((spring) =>
    Math.max(squeezedMin(spring, squeeze, rigidScale), spring.natural * factor),
  );
}

/**
 * Splits the widest of the onsets' rigid extents over the springs: with `reach[i]` the largest
 * extent from onset `i` to the end, spring `i` gets `reach[i] - reach[i + 1]`. The springs from an
 * onset to the bar's end then hold at least its extent, the parts add up to the widest, and no
 * part exceeds its own onset's extent, so the room sits right after the onset that needs it
 * rather than before the barline.
 */
export function rigidShares(extents: readonly number[]): number[] {
  const shares: number[] = [];
  let reach = 0;
  for (let i = extents.length - 1; i >= 0; i--) {
    const next = Math.max(reach, extents[i] ?? 0);
    shares[i] = next - reach;
    reach = next;
  }
  return shares;
}
