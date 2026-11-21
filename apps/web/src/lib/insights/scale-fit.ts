import type { Histogram } from './histogram';
import { sumOf } from './histogram';
import { SCALES, type Scale, type ScaleId } from './scales';

/** A scale explains the notes when it holds at least this share of their weight. */
export const FIT_THRESHOLD = 0.95;
/** Both thirds at this share mean the music mixes major and minor, as the blues does. */
export const MIXED_THIRDS_SHARE = 0.05;

export interface ScaleFit {
  scale: ScaleId;
  /** The share of the weight on scale tones, 0 to 1. */
  coverage: number;
  /** Tones outside the scale, heaviest first, as a pitch class and its share. */
  outside: { pitchClass: number; share: number }[];
  /** The other scales that also reach the threshold, smallest first. */
  alsoFits: { scale: ScaleId; coverage: number }[];
  /** Both the major and the minor third carry 5% or more. */
  mixedThirds: boolean;
}

const coverageOf = (shares: readonly number[], scale: Scale, tonic: number): number =>
  scale.intervals.reduce((sum, interval) => sum + (shares[(tonic + interval) % 12] ?? 0), 0);

/**
 * The smallest scale on `tonic` that explains the notes: of the scales covering at least 95% of
 * the weight, the one with the fewest tones, then the best coverage. When none reaches 95% the
 * best-covering scale wins and its outside tones are listed. A parsimony rule, so a solo on the
 * minor pentatonic is named that and not the natural minor that contains it.
 */
export function fitScale(histogram: Histogram, tonic: number): ScaleFit | undefined {
  const total = sumOf(histogram);
  if (total <= 0) return undefined;
  const shares = histogram.map((value) => value / total);
  const scored = SCALES.map((scale, order) => ({
    scale,
    order,
    coverage: coverageOf(shares, scale, tonic),
  }));
  const fitting = scored
    .filter((entry) => entry.coverage >= FIT_THRESHOLD)
    .sort(
      (a, b) =>
        a.scale.intervals.length - b.scale.intervals.length ||
        b.coverage - a.coverage ||
        a.order - b.order,
    );
  const winner =
    fitting[0] ?? [...scored].sort((a, b) => b.coverage - a.coverage || a.order - b.order)[0];
  if (!winner) return undefined;
  const inside = new Set(winner.scale.intervals.map((interval) => (tonic + interval) % 12));
  const outside = shares
    .map((share, pitchClass) => ({ pitchClass, share }))
    .filter(({ pitchClass, share }) => !inside.has(pitchClass) && share > 0.005)
    .sort((a, b) => b.share - a.share);
  return {
    scale: winner.scale.id,
    coverage: winner.coverage,
    outside,
    alsoFits: fitting
      .slice(1)
      .map((entry) => ({ scale: entry.scale.id, coverage: entry.coverage })),
    mixedThirds:
      (shares[(tonic + 3) % 12] ?? 0) >= MIXED_THIRDS_SHARE &&
      (shares[(tonic + 4) % 12] ?? 0) >= MIXED_THIRDS_SHARE,
  };
}
