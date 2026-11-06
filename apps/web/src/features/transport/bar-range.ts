import type { Id, Score } from '@reprise/model';

import type { BarRange } from '@/state/selection';

/** The range between two master bars, whichever comes first in the score. */
export function orderedRange(score: Score, a: Id, b: Id): BarRange | undefined {
  const ia = score.masterBars.findIndex((bar) => bar.id === a);
  const ib = score.masterBars.findIndex((bar) => bar.id === b);
  if (ia < 0 || ib < 0) return undefined;
  return ia <= ib ? { startBar: a, endBar: b } : { startBar: b, endBar: a };
}

/**
 * Moves the end of `range` away from `anchor` by `by` bars, clamped to the score. With no range,
 * the range runs from the anchor to the bar `by` away.
 */
export function extendRange(
  score: Score,
  range: BarRange | undefined,
  anchor: Id,
  by: -1 | 1,
): BarRange | undefined {
  const moving = !range ? anchor : range.startBar === anchor ? range.endBar : range.startBar;
  const from = score.masterBars.findIndex((bar) => bar.id === moving);
  if (from < 0) return undefined;
  const to = score.masterBars[Math.min(Math.max(from + by, 0), score.masterBars.length - 1)];
  return to && orderedRange(score, anchor, to.id);
}
