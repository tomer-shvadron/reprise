import type { Score } from '@reprise/model';

import type { EditCursor } from '@/state/selection';

/**
 * Whether the "Standard staff" key context holds: the cursor is on a standard staff of a track
 * that takes notes by name. Today that is a keyboard (pitched) track; a guitar's standard staff
 * joins it with pitch entry on strings (#221, part C), by widening this one test.
 */
export function onNotatedStaff(score: Score | undefined, cursor: EditCursor | undefined): boolean {
  if (!score || !cursor || cursor.staff !== 'standard') return false;
  return score.tracks.find(({ id }) => id === cursor.track)?.kind === 'pitched';
}
