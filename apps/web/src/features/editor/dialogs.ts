import type { Id } from '@reprise/model';
import { create } from 'zustand';

/** A section of the master-bar dialog, for the commands that open it focused there. */
export type MasterBarSection = 'time' | 'key' | 'tempo' | 'repeats' | 'directions' | 'section';

/** The dialog the editor has open; one at a time, as Radix dialogs are modal. */
export type EditorDialog =
  | { kind: 'track'; mode: 'add' }
  | { kind: 'track'; mode: 'edit'; trackId: Id }
  | { kind: 'removeTrack'; trackId: Id }
  /** The master-bar dialog; `ids` are the target's bars, fixed when it opens, and `focus` the section to start in. */
  | { kind: 'masterBar'; ids: Id[]; focus?: MasterBarSection };

export interface DialogsState {
  dialog: EditorDialog | undefined;
  /** Where focus returns when the dialog closes; kept after `close` for Radix to read, replaced by the next `open`. */
  returnFocus: HTMLElement | undefined;
  /** `returnFocus` is the control that opened it, when there is one (the sidebar's "+" or "⋯"). */
  open(dialog: EditorDialog, returnFocus?: HTMLElement | null): void;
  close(): void;
}

function createDialogsStore() {
  return create<DialogsState>()((set) => ({
    dialog: undefined,
    returnFocus: undefined,
    open(dialog, returnFocus) {
      set({ dialog, returnFocus: returnFocus ?? undefined });
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
