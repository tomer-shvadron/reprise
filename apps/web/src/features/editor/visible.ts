import type { Id, Notation, Score } from '@reprise/model';

import { visibleTrackIds, type DocumentView } from '@/state/document';

/** The ids of the tracks the view shows, in score order: what ranges and track moves run over. */
export function visibleTracks(score: Score, view: DocumentView): Id[] {
  const ids = visibleTrackIds(view, score);
  return ids === 'all' ? score.tracks.map(({ id }) => id) : ids;
}

/** The notation the view asks of a track: its override, else the track's own. */
export function wantedNotation(
  score: Score,
  view: DocumentView,
  track: number,
): Notation | undefined {
  const found = score.tracks[track];
  return found && (view.notation[found.id] ?? found.display.notation);
}
