import type { Expected } from './corpus';

export interface Detected {
  tonic: number;
  quality: 'major' | 'minor' | 'none';
}

/**
 * The MIREX audio key detection score: 1 for the right key, 0.5 for a perfect fifth away, 0.3 for
 * the relative key, 0.2 for the parallel key, else 0.
 *
 * "No third" is scored by what it says. A right tonic with the other side of the major/minor/none
 * split (a key where none was expected, or none where a key was) scores 0.5: the tonic is right and
 * the mode claim is wrong or withheld, which is better than the parallel key's wrong mode (0.2) and
 * short of a right answer. A fifth away in tonic scores 0.5 whatever the modes, as for any key.
 */
export function mirexScore(expected: Expected, detected: Detected | undefined): number {
  if (!detected) return 0;
  const interval = (detected.tonic - expected.tonic + 12) % 12;
  if (expected.quality === detected.quality && interval === 0) return 1;
  if (expected.quality === 'none' || detected.quality === 'none') {
    if (interval === 0) return 0.5;
    return interval === 7 || interval === 5 ? 0.5 : 0;
  }
  const sameMode = expected.quality === detected.quality;
  if (sameMode && (interval === 7 || interval === 5)) return 0.5;
  if (expected.quality === 'major' && detected.quality === 'minor' && interval === 9) return 0.3;
  if (expected.quality === 'minor' && detected.quality === 'major' && interval === 3) return 0.3;
  if (interval === 0) return 0.2;
  return 0;
}

/** Exact: the tonic and the mode, where "none" is a mode of its own. */
export const isExact = (expected: Expected, detected: Detected | undefined): boolean =>
  mirexScore(expected, detected) === 1;
