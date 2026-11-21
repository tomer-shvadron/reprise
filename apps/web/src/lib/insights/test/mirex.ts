import type { Expected } from './corpus';

export interface Detected {
  tonic: number;
  quality: 'major' | 'minor' | 'none';
}

/**
 * The MIREX audio key detection score: 1 for the right key, 0.5 for a perfect fifth away, 0.3 for
 * the relative key, 0.2 for the parallel key, else 0. A riff with no third is scored on its tonic
 * alone, so a right tonic scores 1 whatever the mode.
 */
export function mirexScore(expected: Expected, detected: Detected | undefined): number {
  if (!detected) return 0;
  const sameMode = expected.quality === detected.quality;
  if (expected.tonic === detected.tonic && (sameMode || expected.quality === 'none')) return 1;
  if (expected.quality === 'none' || detected.quality === 'none') {
    const interval = (detected.tonic - expected.tonic + 12) % 12;
    return interval === 7 || interval === 5 ? 0.5 : 0;
  }
  const interval = (detected.tonic - expected.tonic + 12) % 12;
  if (sameMode && (interval === 7 || interval === 5)) return 0.5;
  if (expected.quality === 'major' && detected.quality === 'minor' && interval === 9) return 0.3;
  if (expected.quality === 'minor' && detected.quality === 'major' && interval === 3) return 0.3;
  if (expected.tonic === detected.tonic) return 0.2;
  return 0;
}

export const isExact = (expected: Expected, detected: Detected | undefined): boolean =>
  mirexScore(expected, detected) === 1;
