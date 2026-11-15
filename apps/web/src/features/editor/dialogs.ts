import type { Id } from '@reprise/model';
import { create } from 'zustand';

/** The dialog the editor has open; one at a time, as Radix dialogs are modal. */
export type EditorDialog =
  | { kind: 'track'; mode: 'add' }
  | { kind: 'track'; mode: 'edit'; trackId: Id }
  | { kind: 'removeTrack'; trackId: Id }
  /** Unsaved changes stand in the way; `onContinue` runs once they are saved or dropped. */
  | { kind: 'unsaved'; action: string; onContinue: () => void };

export interface DialogsState {
  dialog: EditorDialog | undefined;
  open(dialog: EditorDialog): void;
  close(): void;
}

function createDialogsStore() {
  return create<DialogsState>()((set) => ({
    dialog: undefined,
    open(dialog) {
      set({ dialog });
    },
    close() {
      set({ dialog: undefined });
    },
  }));
}

export type DialogsStore = ReturnType<typeof createDialogsStore>;

// Keyed by the services, as the library's store is: createAppRegistry runs more than once per
// services (the app and its tests), so the store cannot be made there.
const stores = new WeakMap<object, DialogsStore>();

export function dialogsOf(services: object): DialogsStore {
  let store = stores.get(services);
  if (!store) {
    store = createDialogsStore();
    stores.set(services, store);
  }
  return store;
}
