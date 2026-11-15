export const DENOMINATORS = [2, 4, 8] as const;
export type Denominator = (typeof DENOMINATORS)[number];
export const MAX_BEATS = 32;

export interface Meter {
  /** The numerator as written: 6 in 6/8. */
  numerator: number;
  denominator: Denominator;
  /** Count a compound meter in dotted beats (6/8 as two); only applies when `isCompound`. */
  dotted: boolean;
}

/** x/8 with x a multiple of 3: 6/8, 9/8 and 12/8 are counted in dotted quarters. */
export function isCompound({ numerator, denominator }: Meter): boolean {
  return denominator === 8 && numerator % 3 === 0;
}

export function countsDotted(meter: Meter): boolean {
  return meter.dotted && isCompound(meter);
}

/** Beats per bar for the engine: 6/8 counted in dotted quarters is two beats. */
export function clickBeats(meter: Meter): number {
  return countsDotted(meter) ? meter.numerator / 3 : meter.numerator;
}

/** The note the BPM counts, so the label is right whatever the meter. */
export function beatName(meter: Meter): string {
  if (countsDotted(meter)) return 'dotted quarter';
  return { 2: 'half', 4: 'quarter', 8: 'eighth' }[meter.denominator];
}

export function clampBeats(beats: number): number {
  return Math.min(MAX_BEATS, Math.max(1, Math.round(beats)));
}
