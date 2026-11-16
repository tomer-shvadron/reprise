import { create } from 'zustand';

import type { AppServices } from './services';

/** The question the unsaved-changes dialog is asking; one at a time, as Radix dialogs are modal. */
export interface UnsavedRequest {
  action: string;
  onContinue: () => void;
}

export interface UnsavedState {
  request: UnsavedRequest | undefined;
  open(request: UnsavedRequest): void;
  close(): void;
}

export type UnsavedStore = ReturnType<typeof createUnsavedStore>;

function createUnsavedStore() {
  return create<UnsavedState>()((set) => ({
    request: undefined,
    open(request) {
      set({ request });
    },
    close() {
      set({ request: undefined });
    },
  }));
}

// Keyed by the services, as the editor's dialog store is: createAppRegistry runs more than once
// per services (the app and its tests), so the store cannot be made there.
const stores = new WeakMap<object, UnsavedStore>();

export function unsavedOf(services: object): UnsavedStore {
  let store = stores.get(services);
  if (!store) {
    store = createUnsavedStore();
    stores.set(services, store);
  }
  return store;
}

/**
 * Runs `onContinue` now when the open document has no unsaved changes, else after the user saves
 * or chooses not to, through the Save / Don't save / Cancel dialog `UnsavedChangesHost` mounts.
 * `action` completes "Save changes to “name” before …?". Every path that replaces or closes the
 * document goes through it: New song, Open, Open recent, the library, Close and quit.
 */
export function whenSaved(
  services: Pick<AppServices, 'document'>,
  action: string,
  onContinue: () => void,
): void {
  if (!services.document.getState().dirty) {
    onContinue();
    return;
  }
  unsavedOf(services).getState().open({ action, onContinue });
}
