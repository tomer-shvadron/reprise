import type { Id } from '@reprise/model';

import { cursorAtTick, rangePatch } from '@/features/editor';
import { libraryOf } from '@/features/library/library';
import { selectTrack, setTrackVisible, trackEntries } from '@/features/tracks';
import { applyLoop, describePosition, seekToBar, type ScoreSection } from '@/features/transport';
import { selectRunning } from '@/state/playback';
import { timelineOf } from '@/state/timeline';

import type { AppServices } from '../services';

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
  if (editing.getState().editing) {
    const { cursor, currentTrack } = selection.getState();
    const at = Math.max(
      0,
      score.tracks.findIndex((track) => track.id === (currentTrack ?? cursor?.track)),
    );
    const next = cursorAtTick(
      score,
      at,
      index,
      0,
      cursor?.voice ?? 0,
      cursor && { string: cursor.string, staff: cursor.staff },
    );
    const track = score.tracks[at];
    if (next && track) {
      selection.getState().setEdit({
        cursor: next,
        currentTrack: track.id,
        selection: {},
        ...rangePatch(score, undefined),
      });
    }
    if (!running) seekToBar(services, score, { masterBarIndex: index, tick: 0 }, true);
  } else {
    selection.getState().selectBars(undefined, bar.id);
    seekToBar(services, score, { masterBarIndex: index, tick: 0 });
  }
  if (!running) {
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
 * playing song keeps playing inside the loop and a stopped one stays stopped. The bars show as
 * selected, so a later selection change or F9 keeps working with the loop.
 */
export function loopBars(
  services: AppServices,
  startIndex: number,
  endIndex: number,
  name: string,
): void {
  const { document, selection, audio, playback, transport } = services;
  const { score } = document.getState();
  const first = score?.masterBars[startIndex];
  const last = score?.masterBars[endIndex];
  if (!score || !first || !last) return;
  const range = { startBar: first.id, endBar: last.id };
  selection.getState().selectBars(range);
  const refusal = applyLoop({ audio, playback }, score, range);
  if (refusal !== undefined) {
    transport.getState().announce(refusal);
    return;
  }
  seekToBar(services, score, { masterBarIndex: startIndex, tick: 0 });
  const bars =
    startIndex === endIndex
      ? `bar ${String(startIndex + 1)}`
      : `bars ${String(startIndex + 1)} to ${String(endIndex + 1)}`;
  transport.getState().announce(name === bars ? `Looping ${bars}` : `Looping ${name}, ${bars}`);
}

/** Selects the track, showing it first when the multitrack view hides it. */
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
  services.transport.getState().announce(`Track ${String(entry.number)}, ${entry.label}`);
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
    services.ui.getState().setScreen('player');
    return;
  }
  void libraryOf(services).requestOpenSong(id, { report: 'notice' });
}
