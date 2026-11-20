import type { Score } from '@reprise/model';

import { sectionAt, sectionsOf } from '@/features/transport';

export type BarResult =
  | { kind: 'bar'; index: number; label: string; detail?: string }
  | { kind: 'message'; message: string };

/**
 * The one row of bar mode. The bar number is the master bar's index plus one, anacrusis included,
 * as the layout counts them. Out of range is a message, not a row, so there is nothing to select.
 */
export function barRow(score: Score | undefined, text: string): BarResult {
  if (!score) return { kind: 'message', message: 'Open a song to go to a bar.' };
  const total = score.masterBars.length;
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1 || number > total) {
    return {
      kind: 'message',
      message: `This song has ${String(total)} ${total === 1 ? 'bar' : 'bars'}.`,
    };
  }
  const index = number - 1;
  const section = sectionAt(sectionsOf(score), index);
  return {
    kind: 'bar',
    index,
    label: `Go to bar ${String(number)}`,
    ...(section ? { detail: section.label } : {}),
  };
}
