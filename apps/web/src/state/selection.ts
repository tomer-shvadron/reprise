import type { Id, Selection } from '@reprise/model';
import { create } from 'zustand';

/** An inclusive range of master bars, by id. */
export interface BarRange {
  startBar: Id;
  endBar: Id;
}

export interface SelectionState {
  currentTrack: Id | undefined;
  /** The model's selection; `{}` when nothing is selected. */
  selection: Selection;
  bars: BarRange | undefined;
  setCurrentTrack(id: Id | undefined): void;
  select(selection: Selection): void;
  selectBars(range: BarRange | undefined): void;
  reset(currentTrack?: Id): void;
}

export function createSelectionStore() {
  return create<SelectionState>()((set) => ({
    currentTrack: undefined,
    selection: {},
    bars: undefined,
    setCurrentTrack(id) {
      set({ currentTrack: id });
    },
    select(selection) {
      set({ selection });
    },
    selectBars(range) {
      set({ bars: range });
    },
    reset(currentTrack) {
      set({ currentTrack, selection: {}, bars: undefined });
    },
  }));
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;
