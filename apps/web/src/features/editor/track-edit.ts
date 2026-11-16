import {
  CommandError,
  addTrack,
  moveTrack as moveTrackCommand,
  newId,
  removeTrack,
  setTrackProperties,
  type Id,
  type Track,
} from '@reprise/model';

import type { AppServices } from '@/app/services';
import { singleTrackOf } from '@/state/document';
import { selectTrack } from '@/features/tracks';

import { dialogsOf } from './dialogs';
import { refusalMessage } from './track-refusal';
import {
  isEmptyChange,
  newTrackProperties,
  trackChanges,
  trackHasNotes,
  type TrackForm,
} from './track-form';

export type TrackEditServices = Pick<AppServices, 'document' | 'selection' | 'playback' | 'audio'>;

export const LAST_TRACK_REASON = 'A score keeps at least one track';

function trackOf(services: TrackEditServices, id: Id | undefined): Track | undefined {
  return services.document.getState().score?.tracks.find((track) => track.id === id);
}

/** The track a keyboard command acts on: the current one, else the first. */
export function currentTrackOf(services: TrackEditServices): Track | undefined {
  const { score } = services.document.getState();
  const id = services.selection.getState().currentTrack;
  return score?.tracks.find((track) => track.id === id) ?? score?.tracks[0];
}

export function openTrackProperties(
  services: TrackEditServices,
  id?: Id,
  returnFocus?: HTMLElement | null,
): void {
  const track = id === undefined ? currentTrackOf(services) : trackOf(services, id);
  if (track) {
    dialogsOf(services)
      .getState()
      .open({ kind: 'track', mode: 'edit', trackId: track.id }, returnFocus);
  }
}

export function openAddTrack(services: TrackEditServices, returnFocus?: HTMLElement | null): void {
  if (services.document.getState().score) {
    dialogsOf(services).getState().open({ kind: 'track', mode: 'add' }, returnFocus);
  }
}

export type ApplyResult = { ok: true } | { ok: false; message: string };

function attempt(run: () => void): ApplyResult {
  try {
    run();
    return { ok: true };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: refusalMessage(error) };
    throw error;
  }
}

/** Edits a track: one `setTrackProperties` with only what changed, and nothing when nothing did. */
export function applyTrackEdit(services: TrackEditServices, id: Id, form: TrackForm): ApplyResult {
  const track = trackOf(services, id);
  if (!track) return { ok: false, message: 'That track is gone.' };
  const changes = trackChanges(track, form);
  if (isEmptyChange(changes)) return { ok: true };
  return attempt(() => {
    services.document.getState().apply(setTrackProperties({ trackId: id }, changes));
  });
}

/**
 * Adds a track at the end as one step and makes it current: single-track view and the edit cursor
 * follow through `selectTrack`'s subscribers, and an explicit multitrack set takes the new id.
 */
export function applyTrackAdd(services: TrackEditServices, form: TrackForm): ApplyResult {
  const { document } = services;
  const score = document.getState().score;
  if (!score) return { ok: false, message: 'No score is open.' };
  const id = newId();
  const result = attempt(() => {
    document
      .getState()
      .apply(
        addTrack({ kind: form.kind, index: score.tracks.length, id }, newTrackProperties(form)),
      );
  });
  if (!result.ok) return result;
  const { view } = document.getState();
  if (view.tracks !== 'all') document.getState().setVisibleTracks([...view.tracks, id]);
  selectTrack(services, id);
  return result;
}

/** Why a track cannot be removed, or undefined. */
export function removeBlocker(services: TrackEditServices): string | undefined {
  return (services.document.getState().score?.tracks.length ?? 0) <= 1
    ? LAST_TRACK_REASON
    : undefined;
}

export function removeTrackNow(services: TrackEditServices, id: Id): ApplyResult {
  const { document } = services;
  const { score, view } = document.getState();
  const index = score?.tracks.findIndex((track) => track.id === id) ?? -1;
  if (!score || index < 0) return { ok: false, message: 'That track is gone.' };
  // Read first: the app's own subscription moves a removed current track to the first one, and
  // single-track view stops matching once its track is gone.
  const wasCurrent = services.selection.getState().currentTrack === id;
  const wasShown = singleTrackOf(view, score) === id;
  const result = attempt(() => {
    document.getState().apply(removeTrack({ trackId: id }));
  });
  if (!result.ok) return result;
  if (wasCurrent) {
    const next = document.getState().score?.tracks[Math.min(index, score.tracks.length - 2)];
    if (next) selectTrack(services, next.id);
  }
  // Single-track view follows the current track, so undo (which brings the removed track back
  // under the same id) leaves the view on the track the sidebar highlights.
  const current = services.selection.getState().currentTrack;
  if (wasShown && current !== undefined) document.getState().setSingleTrack(current);
  return result;
}

/** Removes a track; one holding notes asks first, since only undo brings its notes back. */
export function requestRemoveTrack(
  services: TrackEditServices,
  id?: Id,
  options: { returnFocus?: HTMLElement | null } = {},
): void {
  const { score } = services.document.getState();
  const track = id === undefined ? currentTrackOf(services) : trackOf(services, id);
  if (!score || !track) return;
  if (removeBlocker(services) !== undefined) return;
  if (trackHasNotes(score, track.id)) {
    dialogsOf(services)
      .getState()
      .open({ kind: 'removeTrack', trackId: track.id }, options.returnFocus);
  } else {
    removeTrackNow(services, track.id);
  }
}

/** Whether the track can move that way, for the menu's disabled items. */
export function canMoveTrack(services: TrackEditServices, id: Id, delta: -1 | 1): boolean {
  const tracks = services.document.getState().score?.tracks ?? [];
  const index = tracks.findIndex((track) => track.id === id);
  return index >= 0 && index + delta >= 0 && index + delta < tracks.length;
}

export function moveTrackBy(services: TrackEditServices, id: Id, delta: -1 | 1): void {
  if (!canMoveTrack(services, id, delta)) return;
  const index = (services.document.getState().score?.tracks ?? []).findIndex(
    (track) => track.id === id,
  );
  services.document.getState().apply(moveTrackCommand({ trackId: id }, index + delta));
}
