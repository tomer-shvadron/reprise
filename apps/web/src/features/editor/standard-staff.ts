import type { Score } from '@reprise/model';

import type { EditCursor } from '@/state/selection';

/**
 * Whether the "Standard staff" key context holds: the cursor is on a standard staff of a track
 * that takes notes by name: a keyboard track's, or a fretted track's, whether it is shown as
 * standard notation alone or beside its tab. A drum track's staff is a percussion one.
 */
export function onNotatedStaff(score: Score | undefined, cursor: EditCursor | undefined): boolean {
  if (!score || !cursor || cursor.staff !== 'standard') return false;
  const track = score.tracks.find(({ id }) => id === cursor.track);
  return track?.kind === 'pitched' || (track?.kind === 'fretted' && track.tuning.length > 0);
}
