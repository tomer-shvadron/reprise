import type { Id, Score } from '@reprise/model';

import { cursorAtTick, rangePatch } from '@/features/editor';
import { libraryOf } from '@/features/library/library';
import { selectTrack, setTrackVisible, trackEntries } from '@/features/tracks';
import { applyLoop, describePosition, seekToBar, type ScoreSection } from '@/features/transport';
import { selectRunning } from '@/state/playback';
import { timelineOf } from '@/state/timeline';

import type { AppServices } from '../services';

/** The edit cursor on the first stop of bar `index` in the current track, keeping its voice, string, drum lane and staff. */
function caretAt(services: AppServices, score: Score, index: number) {
  const { selection } = services;
  const { cursor, currentTrack } = selection.getState();
  const at = Math.max(
    0,
    score.tracks.findIndex((track) => track.id === (currentTrack ?? cursor?.track)),
  );
  const track = score.tracks[at];
  const next = cursorAtTick(
    score,
    at,
    index,
    0,
    cursor?.voice ?? 0,
    cursor && {
      string: cursor.string,
      staff: cursor.staff,
      ...(cursor.pitch !== undefined && { pitch: cursor.pitch }),
    },
  );
  return next && track ? { cursor: next, track } : undefined;
}

/**
 * Goes to the start of bar `index` as a click on it would: in play mode the bar is selected and
 * the playhead seeks, ending a loop the bar is outside of; in edit mode the cursor moves to the
 * bar's first stop in the current track, and a stopped playhead follows it without ending a loop.
 */
export function goToBar(services: AppServices, index: number): void {
  const { document, selection, editing, playback, transport } = services;
  const { score } = document.getState();
  const bar = score?.masterBars[index];
  if (!score || !bar) return;
  const running = selectRunning(playback.getState());
  let seeked: boolean;
  if (editing.getState().editing) {
    const placed = caretAt(services, score, index);
    if (placed) {
      selection.getState().setEdit({
        cursor: placed.cursor,
        currentTrack: placed.track.id,
        selection: {},
        ...rangePatch(score, undefined),
      });
    }
    seeked = !running && seekToBar(services, score, { masterBarIndex: index, tick: 0 }, true);
  } else {
    selection.getState().selectBars(undefined, bar.id);
    seeked = seekToBar(services, score, { masterBarIndex: index, tick: 0 });
  }
  // Only after a seek: a refusal ("Bar 12 is not played") is already announced and must stand.
  if (seeked && !running) {
    transport
      .getState()
      .announce(describePosition(timelineOf(score), playback.getState().position).sentence);
  }
}

export function goToSection(services: AppServices, section: ScoreSection): void {
  goToBar(services, section.startIndex);
}

/**
 * Loops bars `startIndex` to `endIndex` and moves to the start, leaving playback as it is: a
 * playing song keeps playing inside the loop and a stopped one stays stopped. The loop is applied
 * first, so a range the engine refuses changes nothing but the announcement. The bars then show as
 * selected: in edit mode as a bars range with the caret on the first stop, as ↩ would leave it,
 * which keeps `bars` mirroring `range`; in play mode as a bar selection.
 */
export function loopBars(
  services: AppServices,
  startIndex: number,
  endIndex: number,
  name: string,
): void {
  const { document, selection, audio, playback, transport, editing } = services;
  const { score } = document.getState();
  const first = score?.masterBars[startIndex];
  const last = score?.masterBars[endIndex];
  if (!score || !first || !last) return;
  const range = { startBar: first.id, endBar: last.id };
  const refusal = applyLoop({ audio, playback }, score, range);
  if (refusal !== undefined) {
    transport.getState().announce(refusal);
    return;
  }
  const placed = editing.getState().editing ? caretAt(services, score, startIndex) : undefined;
  if (placed) {
    const end = (masterBar: string) => ({ track: placed.track.id, masterBar, beat: undefined });
    selection.getState().setEdit({
      cursor: placed.cursor,
      currentTrack: placed.track.id,
      selection: {},
      ...rangePatch(score, { kind: 'bars', anchor: end(first.id), focus: end(last.id) }),
    });
  } else {
    selection.getState().selectBars(range);
  }
  seekToBar(services, score, { masterBarIndex: startIndex, tick: 0 });
  const bars =
    startIndex === endIndex
      ? `bar ${String(startIndex + 1)}`
      : `bars ${String(startIndex + 1)} to ${String(endIndex + 1)}`;
  transport.getState().announce(name === bars ? `Looping ${bars}` : `Looping ${name}, ${bars}`);
}

/** Selects the track, showing it first when the multitrack view hides it; the status bar's track flash announces it. */
export function pickTrack(services: AppServices, id: Id): void {
  const { document, selection } = services;
  const { score, view } = document.getState();
  if (!score) return;
  const entry = trackEntries(score, view.tracks, selection.getState().currentTrack).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) return;
  if (entry.hidden) setTrackVisible(services, id, true);
  selectTrack(services, id);
}

/** Single-track view of the track. */
export function showOnlyTrack(services: AppServices, id: Id): void {
  selectTrack(services, id);
  services.document.getState().setSingleTrack(id);
}

/**
 * Opens a library song on the player. The open song is only brought forward; another goes through
 * the library's own unsaved-changes question. The palette closes before this runs, so that dialog
 * is never stacked over it.
 */
export function openSong(services: AppServices, id: Id): void {
  if (services.document.getState().songId === id) {
    services.ui.getState().closeSheet();
    return;
  }
  void libraryOf(services).requestOpenSong(id, { report: 'notice' });
}
