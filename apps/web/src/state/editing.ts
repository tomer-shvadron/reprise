import { create } from 'zustand';

export interface EditingState {
  /** Whether the score is in edit mode: clicks and keys edit instead of seeking and playing. */
  editing: boolean;
  setEditing(editing: boolean): void;
  toggle(): void;
}

/**
 * Only the flag. The edit cursor and range selection (WP-080) live in the selection store, and
 * entry state (duration, voice, insert or overwrite) belongs to the editor feature.
 */
export function createEditingStore() {
  return create<EditingState>()((set) => ({
    editing: false,
    setEditing(editing) {
      set({ editing });
    },
    toggle() {
      set((state) => ({ editing: !state.editing }));
    },
  }));
}

export type EditingStore = ReturnType<typeof createEditingStore>;
