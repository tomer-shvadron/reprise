import { shownNotation, type Score } from '@reprise/model';

import type { DocumentView } from '@/state/document';
import type { EditCursor } from '@/state/selection';

import { wantedNotation } from './visible';

/**
 * Whether the "Standard staff" key context holds: the cursor is on a standard staff of a track
 * that takes notes by name: a keyboard track's, or a fretted track's, whether it is shown as
 * standard notation alone or beside its tab, and the view draws that staff. A drum track's staff is a percussion one.
 */
export function onNotatedStaff(
  score: Score | undefined,
  cursor: EditCursor | undefined,
  view?: DocumentView,
): boolean {
  if (!score || !cursor || cursor.staff !== 'standard') return false;
  const index = score.tracks.findIndex(({ id }) => id === cursor.track);
  const track = score.tracks[index];
  if (track?.kind !== 'pitched' && !(track?.kind === 'fretted' && track.tuning.length > 0)) {
    return false;
  }
  // The staff must be drawn: a guitar shown as tab only has none, whatever the cursor remembers.
  const wanted = view ? wantedNotation(score, view, index) : track.display.notation;
  return wanted === undefined || shownNotation(track, wanted) !== 'tab';
}
