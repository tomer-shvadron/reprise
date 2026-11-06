import type { Id } from '@reprise/model';

import type { AppServices } from '@/app/services';
import type { DocumentView } from '@/state/document';

/**
 * A song's track session, for the library to keep per song (WP-060). Volume, pan and instrument
 * are not here: they are score data and travel with the saved song.
 */
export interface TrackSession {
  version: 1;
  view: DocumentView;
  /** The session's mute and solo overrides only, never the file's own flags. */
  mixer: Record<Id, { mute?: boolean; solo?: boolean }>;
  currentTrack?: Id;
}

type SessionServices = Pick<AppServices, 'document' | 'playback' | 'selection'>;

export function captureTrackSession(services: SessionServices): TrackSession | undefined {
  const { score, view } = services.document.getState();
  if (!score) return undefined;
  const mixer: TrackSession['mixer'] = {};
  for (const [id, params] of Object.entries(services.playback.getState().mixer)) {
    const entry: { mute?: boolean; solo?: boolean } = {};
    if (params.mute !== undefined) entry.mute = params.mute;
    if (params.solo !== undefined) entry.solo = params.solo;
    if (Object.keys(entry).length > 0) mixer[id] = entry;
  }
  const { currentTrack } = services.selection.getState();
  const session: TrackSession = { version: 1, view, mixer };
  if (currentTrack !== undefined) session.currentTrack = currentTrack;
  return session;
}

/** Restores a session into the open document, dropping ids its score no longer has. */
export function restoreTrackSession(
  services: Pick<AppServices, 'document' | 'selection' | 'audio'>,
  session: TrackSession,
): void {
  const { score } = services.document.getState();
  if (!score) return;
  const ids = new Set(score.tracks.map((track) => track.id));
  const known = (id: Id) => ids.has(id);
  const { tracks, notation, only } = session.view;
  const view: DocumentView = {
    tracks: tracks === 'all' ? 'all' : tracks.filter(known),
    notation: Object.fromEntries(Object.entries(notation).filter(([id]) => known(id))),
  };
  if (view.tracks !== 'all' && view.tracks.length === 0) view.tracks = 'all';
  if (only !== undefined && known(only)) view.only = only;
  services.document.getState().setView(view);
  for (const [id, params] of Object.entries(session.mixer)) {
    if (known(id)) services.audio.setTrack(id, params);
  }
  if (session.currentTrack !== undefined && known(session.currentTrack)) {
    services.selection.getState().setCurrentTrack(session.currentTrack);
  }
}

/** Calls `listener` on a view, mixer or current-track change within one document, never a switch. */
export function watchTrackSession(
  services: SessionServices,
  listener: (session: TrackSession, documentId: Id) => void,
): () => void {
  const { document, playback, selection } = services;
  let known = document.getState().id;
  // A switch resets the view, the mixer and the selection in one synchronous cascade, in an order
  // that depends on subscription order; everything until the next microtask belongs to it.
  let switching = false;
  const changed = () => {
    const { id } = document.getState();
    if (id !== known) {
      known = id;
      switching = true;
      queueMicrotask(() => {
        switching = false;
      });
    }
    if (switching || id === undefined) return;
    const session = captureTrackSession(services);
    if (session) listener(session, id);
  };
  const unsubscribers = [
    document.subscribe((state, previous) => {
      if (state.id !== previous.id || state.view !== previous.view) changed();
    }),
    playback.subscribe((state, previous) => {
      if (state.mixer !== previous.mixer) changed();
    }),
    selection.subscribe((state, previous) => {
      if (state.currentTrack !== previous.currentTrack) changed();
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
