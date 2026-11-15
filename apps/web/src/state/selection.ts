import type { StaffType } from '@reprise/layout';
import type { Id, Selection } from '@reprise/model';
import { create } from 'zustand';

/** An inclusive range of master bars, by id. */
export interface BarRange {
  startBar: Id;
  endBar: Id;
}

/**
 * The edit cursor. It holds ids, so an edit, undo or redo leaves it on the same beat; `at` holds
 * the indices it last resolved to (`track` indexes `score.tracks`, `bar` indexes `score.masterBars`,
 * `beat` indexes the voice's stops, where the end slot is the last stop, `beats.length`), the fallback when an edit removes its beat, bar or track.
 */
export interface EditCursor {
  track: Id;
  masterBar: Id;
  /** `Bar.voices` index, 0 to 3. */
  voice: number;
  /** The beat; undefined is the slot after the voice's last beat, the only position in an empty voice. */
  beat: Id | undefined;
  /** 1 = highest-pitched string, as `Note.string`; 0 on a track without strings. */
  string: number;
  /** Which of the track's staves holds the cursor; decides where it is drawn in `both`. */
  staff: StaffType;
  at: { track: number; bar: number; beat: number };
}

/** One end of a range. `beat` undefined: that end takes its whole bar. */
export interface RangeEnd {
  track: Id;
  masterBar: Id;
  beat: Id | undefined;
}

/**
 * A rectangle of tracks (anchor to focus, in score order) by a stretch of time. `beats`: from the
 * earlier end's onset to the later end's end, every voice. `bars`: whole master bars, both `beat`s undefined.
 */
export interface EditRange {
  kind: 'beats' | 'bars';
  anchor: RangeEnd;
  focus: RangeEnd;
}

export interface SelectionState {
  currentTrack: Id | undefined;
  /** The model's selection; `{}` when nothing is selected. */
  selection: Selection;
  bars: BarRange | undefined;
  /** The fixed end of the bar range, which Shift+click and extending move away from. */
  barsAnchor: Id | undefined;
  cursor: EditCursor | undefined;
  range: EditRange | undefined;
  setCurrentTrack(id: Id | undefined): void;
  select(selection: Selection): void;
  /** `anchor` defaults to the range's start; a plain click passes no range and its bar. */
  selectBars(range: BarRange | undefined, anchor?: Id): void;
  /**
   * Sets the keys present in `patch` in one update; a key present as undefined clears it. The
   * editor keeps the invariants: cursor.track === currentTrack, and `bars`/`barsAnchor` mirror
   * `range`'s master-bar span (the store cannot order master bars).
   */
  setEdit(
    patch: Partial<
      Pick<
        SelectionState,
        'cursor' | 'range' | 'selection' | 'bars' | 'barsAnchor' | 'currentTrack'
      >
    >,
  ): void;
  reset(currentTrack?: Id): void;
}

export function createSelectionStore() {
  return create<SelectionState>()((set) => ({
    currentTrack: undefined,
    selection: {},
    bars: undefined,
    barsAnchor: undefined,
    cursor: undefined,
    range: undefined,
    setCurrentTrack(id) {
      set({ currentTrack: id });
    },
    select(selection) {
      set({ selection });
    },
    selectBars(range, anchor) {
      set({ bars: range, barsAnchor: anchor ?? range?.startBar, range: undefined });
    },
    setEdit(patch) {
      set(patch);
    },
    reset(currentTrack) {
      set({
        currentTrack,
        selection: {},
        bars: undefined,
        barsAnchor: undefined,
        cursor: undefined,
        range: undefined,
      });
    },
  }));
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;
