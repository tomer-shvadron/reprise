/**
 * Ticks closer than this are one onset: sums of tuplet durations leave a float of error that
 * `measure` already ignores, so every comparison of ticks across voices goes through it.
 */
export const TICK_EPSILON = 1e-6;

/** Whether two ticks are the same onset. */
export function sameTick(a: number, b: number): boolean {
  return Math.abs(a - b) < TICK_EPSILON;
}
