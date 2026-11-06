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
  /** The fixed end of the bar range, which Shift+click and extending move away from. */
  barsAnchor: Id | undefined;
  setCurrentTrack(id: Id | undefined): void;
  select(selection: Selection): void;
  /** `anchor` defaults to the range's start; a plain click passes no range and its bar. */
  selectBars(range: BarRange | undefined, anchor?: Id): void;
  reset(currentTrack?: Id): void;
}

export function createSelectionStore() {
  return create<SelectionState>()((set) => ({
    currentTrack: undefined,
    selection: {},
    bars: undefined,
    barsAnchor: undefined,
    setCurrentTrack(id) {
      set({ currentTrack: id });
    },
    select(selection) {
      set({ selection });
    },
    selectBars(range, anchor) {
      set({ bars: range, barsAnchor: anchor ?? range?.startBar });
    },
    reset(currentTrack) {
      set({ currentTrack, selection: {}, bars: undefined, barsAnchor: undefined });
    },
  }));
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;
