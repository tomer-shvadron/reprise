import type { Id } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { watchTrackSession, type TrackSession } from '@/features/tracks';

export const SESSION_DEBOUNCE_MS = 500;

export interface SessionKeeper {
  /** Writes a pending session now and stops watching. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Keeps the open document's track session on its song, debounced. Start it only after the
 * restore, or the restore would be written straight back. It stops itself, flushing, when the
 * document switches, and ignores any session that is not its own document's.
 */
export function startSessionKeeper(
  services: Pick<AppServices, 'document' | 'playback' | 'selection'>,
  songId: Id,
  save: (songId: Id, session: TrackSession) => Promise<void>,
  debounceMs = SESSION_DEBOUNCE_MS,
): SessionKeeper {
  const { document } = services;
  const documentId = document.getState().id;
  let pending: TrackSession | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let writing: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const session = pending;
    pending = undefined;
    if (session) {
      writing = writing
        .then(() => save(songId, session))
        .catch((error: unknown) => {
          console.warn('Could not keep the track session', error);
        });
    }
    return writing;
  };

  const stop = () => {
    if (stopped) return writing;
    stopped = true;
    unwatch();
    unsubscribe();
    return flush();
  };

  const unwatch = watchTrackSession(services, (session, id) => {
    if (stopped || id !== documentId || document.getState().songId !== songId) return;
    pending = session;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  });
  const unsubscribe = document.subscribe((state) => {
    if (state.id !== documentId) void stop();
  });

  return { stop };
}
