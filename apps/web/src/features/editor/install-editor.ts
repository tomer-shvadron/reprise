import type { Score } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { passIndexAt } from '@/features/transport/seek';
import { timelineOf } from '@/state/timeline';

import type { DocumentView } from '@/state/document';

import { cursorAtTick, defaultStaff, reconcile } from './cursor';
import { undoLanding } from './undo-landing';
import { visibleTracks, wantedNotation } from './visible';
import { cursorOnTrack } from './navigation';

type InstallDeps = Pick<AppServices, 'document' | 'selection' | 'editing' | 'playback'>;

/**
 * Keeps the edit cursor honest. After an undo or redo it first puts the cursor where the replayed
 * edit was (`undoLanding`); after each edit, undo or redo it reconciles the selection store's
 * cursor, range and picked ids with the new score; it moves the cursor to the same bar and onset
 * when the current track changes; and when edit mode turns on without a cursor it puts one at the
 * playhead's beat in the current track, else at the first stop. Returns the cleanup.
 */
export function installEditor(deps: InstallDeps): () => void {
  const { document, selection, editing, playback } = deps;

  const stopDocument = document.subscribe((state, previous) => {
    // A new document resets the selection store itself; only an edit of the same one reconciles.
    if (state.id !== previous.id || state.score === previous.score || !state.score) return;
    const current = selection.getState();
    const landed =
      // Only while editing: the cursor outlives edit mode, and an undo in play mode must not move
      // the hidden cursor or switch the current track under the sidebar and the fretboard.
      (state.lastStep === 'undo' || state.lastStep === 'redo') &&
      state.lastChange &&
      current.cursor &&
      editing.getState().editing
        ? undoLanding(
            state.score,
            state.lastChange,
            current.cursor,
            visibleTracks(state.score, state.view),
          )
        : undefined;
    // The landing is a cursor the score holds, so reconcile only has the range and picks to settle.
    const patch = reconcile(state.score, landed ? { ...current, cursor: landed } : current);
    if (!landed) {
      if (patch) current.setEdit(patch);
      return;
    }
    current.setEdit({ currentTrack: landed.track, ...patch, cursor: patch?.cursor ?? landed });
  });

  const stopSelection = selection.subscribe((state, previous) => {
    const { score } = document.getState();
    const { cursor, currentTrack } = state;
    if (!score || !cursor || state.currentTrack === previous.currentTrack) return;
    if (currentTrack === undefined || cursor.track === currentTrack) return;
    const next = cursorOnTrack(score, cursor, currentTrack);
    if (next) selection.getState().setEdit({ cursor: next });
  });

  const stopEditing = editing.subscribe((state, previous) => {
    if (!state.editing && previous.editing && selection.getState().range) {
      // The range is an edit-mode selection; play mode has the bar selection and its drag preview.
      selection.getState().setEdit({ range: undefined, bars: undefined, barsAnchor: undefined });
    }
    if (!state.editing || previous.editing) return;
    const { score } = document.getState();
    if (!score || selection.getState().cursor) return;
    const cursor = entryCursor(
      score,
      document.getState().view,
      selection.getState().currentTrack,
      playback.getState().position,
    );
    if (cursor) selection.getState().setEdit({ cursor, currentTrack: cursor.track });
  });

  return () => {
    stopDocument();
    stopSelection();
    stopEditing();
  };
}

type Position = ReturnType<AppServices['playback']['getState']>['position'];

/** The cursor at the playhead's bar and onset on the current track, voice 0; the first stop with no playhead. */
function entryCursor(
  score: Score,
  view: DocumentView,
  trackId: string | undefined,
  position: Position,
) {
  const track = Math.max(
    0,
    score.tracks.findIndex(({ id }) => id === trackId),
  );
  let bar = 0;
  let tick = 0;
  if (position) {
    const timeline = timelineOf(score);
    const at = position.position.playbackTick;
    const pass = timeline.map.passes[passIndexAt(timeline, at)];
    if (pass) {
      bar = pass.masterBarIndex;
      tick = at - pass.startTick;
    }
  }
  return cursorAtTick(score, track, bar, tick, 0, {
    string: 1,
    staff: defaultStaff(score, track, wantedNotation(score, view, track)),
  });
}
