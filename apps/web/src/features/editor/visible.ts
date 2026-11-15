import type { Id, Score } from '@reprise/model';

import { visibleTrackIds, type DocumentView } from '@/state/document';

/** The ids of the tracks the view shows, in score order: what ranges and track moves run over. */
export function visibleTracks(score: Score, view: DocumentView): Id[] {
  const ids = visibleTrackIds(view, score);
  return ids === 'all' ? score.tracks.map(({ id }) => id) : ids;
}
