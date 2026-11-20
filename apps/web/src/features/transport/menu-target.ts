import type { Id, Score } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { scoreIndex } from '@/lib/score-index';
import type { BarRange } from '@/state/selection';

import { sectionsOf } from './sections';

type TargetServices = Pick<AppServices, 'document' | 'selection' | 'menuTarget'>;

/** A place a command starts or loops from: a bar and the ticks into it. */
export interface BarPlace {
  masterBarIndex: number;
  tick: number;
}

const oneBar = (score: Score, id: Id): BarRange | undefined =>
  score.masterBars.some((bar) => bar.id === id) ? { startBar: id, endBar: id } : undefined;

/**
 * A section's bars: from the marker's bar to the bar before the next marker. `masterBarId` is
 * the marker's bar; a bar inside a section gives that section's range, a bar before the first
 * marker gives none.
 */
export function sectionRange(score: Score, masterBarId: Id): BarRange | undefined {
  const index = score.masterBars.findIndex((bar) => bar.id === masterBarId);
  const section = sectionsOf(score).find((s) => index >= s.startIndex && index <= s.endIndex);
  const start = section && score.masterBars[section.startIndex];
  const end = section && score.masterBars[section.endIndex];
  return start && end ? { startBar: start.id, endBar: end.id } : undefined;
}

/**
 * The bars a menu command acts on: what was right-clicked when a menu is open (a note, beat,
 * chord name or bar names its bar, a marker its own bar, a range the selection), else the
 * selected bars. A command reads this before its first `await`, as the target is cleared after.
 */
export function targetBars(services: TargetServices): BarRange | undefined {
  const { score } = services.document.getState();
  if (!score) return undefined;
  const target = services.menuTarget.getState().target;
  switch (target?.kind) {
    case 'note':
    case 'beat':
    case 'bar':
    case 'chord':
    case 'section':
      return oneBar(score, target.masterBar);
    default:
      return services.selection.getState().bars;
  }
}

/** The beat or bar a menu command starts from: the target, else the selected bars, else the cursor. */
export function targetPlace(services: TargetServices): BarPlace | undefined {
  const { score } = services.document.getState();
  if (!score) return undefined;
  const index = scoreIndex(score);
  const target = services.menuTarget.getState().target;
  if (target?.kind === 'note' || target?.kind === 'beat' || target?.kind === 'chord') {
    const beat = index.beats.get(target.beat);
    if (beat) return { masterBarIndex: beat.masterBarIndex, tick: beat.tick };
  }
  const bars =
    target?.kind === 'range' && target.bar !== undefined
      ? { startBar: target.bar, endBar: target.bar }
      : targetBars(services);
  const bar = bars && index.barIndex.get(bars.startBar);
  if (bar !== undefined) return { masterBarIndex: bar, tick: 0 };
  const cursor = services.selection.getState().cursor;
  const beat = cursor?.beat === undefined ? undefined : index.beats.get(cursor.beat);
  if (beat) return { masterBarIndex: beat.masterBarIndex, tick: beat.tick };
  const barOfCursor = cursor && index.barIndex.get(cursor.masterBar);
  return barOfCursor === undefined ? undefined : { masterBarIndex: barOfCursor, tick: 0 };
}
