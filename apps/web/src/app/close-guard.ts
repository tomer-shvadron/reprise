import type { AppServices } from './services';
import { unsavedOf, whenSaved } from './when-saved';

export interface CloseGuardDeps {
  services: Pick<AppServices, 'document' | 'platform'>;
  /** Removes the open document's draft: the user chose Don't save, so it must not be offered. */
  discardDraft: () => Promise<void>;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Asks before the window goes while the document is modified.
 *
 * Desktop (the platform has `onCloseRequest`): main holds the close and asks; the answer goes
 * through the Save / Don't save / Cancel dialog, then `confirmClose`. No `beforeunload` is
 * registered there, because Electron cancels a close that has one, silently. A request while the
 * dialog is already open changes nothing.
 *
 * Web: a `beforeunload` listener exists only while the document is modified and shows the
 * browser's generic prompt, the protection there. A page that goes (Leave, a closed tab) cannot
 * be waited for, so the last second of edits, or all of a first edit, can be missing from the
 * draft the next launch offers; the draft the keeper wrote before that is kept. Returns the undo.
 */
export function installCloseGuard(deps: CloseGuardDeps): () => void {
  const { services, discardDraft } = deps;
  const { platform, document } = services;
  const target = deps.target ?? window;
  if (Reflect.has(platform, 'onCloseRequest')) {
    const stop = platform.onCloseRequest?.(() => {
      // The open dialog is answered first (it may be about another action, which does not close
      // the window); main asks again on the next close attempt.
      if (unsavedOf(services).getState().request) return;
      whenSaved(
        services,
        'quitting',
        () => {
          // Both ways out clear the draft before the window goes: Don't save leaves the document
          // modified, and a Save's own removal may still be queued behind a write in flight.
          void discardDraft()
            .catch((error: unknown) => {
              console.warn('Could not remove the draft', error);
            })
            .finally(() => {
              platform.confirmClose?.(true);
            });
        },
        () => {
          platform.confirmClose?.(false);
        },
      );
    });
    return () => {
      stop?.();
    };
  }

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
  };
  let listening = false;
  const sync = () => {
    const modified = document.getState().id !== undefined && document.getState().dirty;
    if (modified === listening) return;
    listening = modified;
    if (modified) target.addEventListener('beforeunload', onBeforeUnload);
    else target.removeEventListener('beforeunload', onBeforeUnload);
  };
  sync();
  const unsubscribe = document.subscribe(sync);
  return () => {
    unsubscribe();
    if (listening) target.removeEventListener('beforeunload', onBeforeUnload);
    listening = false;
  };
}
