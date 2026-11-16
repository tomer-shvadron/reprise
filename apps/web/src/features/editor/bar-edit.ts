import {
  chain,
  insertBar,
  newId,
  removeBar,
  setMasterBar,
  type Command,
  type Id,
  type MasterBar,
  type Score,
} from '@reprise/model';

import type { SelectionState } from '@/state/selection';

import { resolveCursor } from './cursor';
import { rangeBars } from './range';

/** The master bars a bar command acts on, in score order. */
export interface BarTarget {
  ids: Id[];
  first: Id;
  last: Id;
}

export function targetOf(ids: readonly Id[]): BarTarget | undefined {
  const [first] = ids;
  const last = ids.at(-1);
  return first === undefined || last === undefined ? undefined : { ids: [...ids], first, last };
}

/**
 * The bars a range covers (a beats range takes every bar it touches), else the cursor's bar;
 * undefined without either.
 */
export function barTarget(
  score: Score,
  state: Pick<SelectionState, 'cursor' | 'range'>,
): BarTarget | undefined {
  const { range, cursor } = state;
  if (range) {
    const target = targetOf(rangeBars(score, range));
    if (target) return target;
  }
  const bar = cursor && resolveCursor(score, cursor)?.bar;
  const id = bar === undefined ? undefined : score.masterBars[bar]?.id;
  return id === undefined ? undefined : targetOf([id]);
}

const indexOf = (score: Score, id: Id): number =>
  score.masterBars.findIndex((bar) => bar.id === id);

/** A bar before the target's first bar, or after its last, as a command plus the new bar's id. */
export function planInsertBar(
  score: Score,
  target: BarTarget,
  where: 'before' | 'after',
): { command: Command; bar: Id } | undefined {
  const index = indexOf(score, where === 'before' ? target.first : target.last);
  if (index < 0) return undefined;
  const id = newId();
  return {
    command: insertBar({ index: where === 'before' ? index : index + 1, id }),
    bar: id,
  };
}

/**
 * Deletes the target's bars as one step. `chain` runs each `removeBar` on the score the one
 * before left, so any order finds its bar; highest index first is kept for a predictable order.
 * A tempo mark on a deleted bar carries onto the next one, as `removeBar` does. Refusing every bar is the model's rule; `deleteBlocker` asks first.
 */
export function planDeleteBars(score: Score, target: BarTarget): Command | undefined {
  const ids = target.ids
    .map((id) => ({ id, index: indexOf(score, id) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => b.index - a.index)
    .map(({ id }) => removeBar({ masterBarId: id }));
  return ids.length === 0 ? undefined : chain('deleteBars', ids);
}

export const LAST_BAR_REASON = 'A score keeps at least one bar';

/** Why the target cannot be deleted, or undefined. */
export function deleteBlocker(score: Score, target: BarTarget): string | undefined {
  return target.ids.length >= score.masterBars.length ? LAST_BAR_REASON : undefined;
}

const repeatsOf = (bar: MasterBar | undefined) => bar?.repeat ?? { start: false, endCount: 0 };

/** `[`: toggles the repeat start on the target's first bar. */
export function planToggleRepeatStart(score: Score, target: BarTarget): Command | undefined {
  const bar = score.masterBars[indexOf(score, target.first)];
  if (!bar) return undefined;
  const { start, endCount } = repeatsOf(bar);
  return setMasterBar({ masterBarId: bar.id }, { repeat: { start: !start, endCount } });
}

/** The play count a repeat end takes when it is switched on without the dialog. */
export const DEFAULT_PLAY_COUNT = 2;

/** `]`: toggles the repeat end on the target's last bar between none and the default count. */
export function planToggleRepeatEnd(score: Score, target: BarTarget): Command | undefined {
  const bar = score.masterBars[indexOf(score, target.last)];
  if (!bar) return undefined;
  const { start, endCount } = repeatsOf(bar);
  return setMasterBar(
    { masterBarId: bar.id },
    { repeat: { start, endCount: endCount > 0 ? 0 : DEFAULT_PLAY_COUNT } },
  );
}
