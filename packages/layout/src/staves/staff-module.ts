import {
  TIE_REACH_BARS,
  type Bar,
  type Clef,
  type KeySignature,
  type MasterBar,
  type Score,
  type Track,
} from '@reprise/model';

import type { LayoutSink } from '../primitives';
import type { StaffType } from '../types';
import type { LaneBands, LaneRequests } from './lanes';

/**
 * How many bars either side of its own a module's `render` may read: a tie half at a system end
 * looks up to `TIE_REACH_BARS` ahead for its continuation. The cache rebuilds every system within
 * this many bars of a re-measured one.
 */
export const BAR_REACH = TIE_REACH_BARS;

/** Vertical shape of a staff: `lines` lines, `lineSpacing` px apart. */
export interface StaffGeometry {
  lines: number;
  lineSpacing: number;
}

/** One track's bar as a staff module sees it, with the context it is drawn in. */
export interface StaffBar {
  readonly score: Score;
  readonly track: Track;
  readonly trackIndex: number;
  /** The track's visible staves, top to bottom; more than one means "both" mode. */
  readonly staves: readonly StaffType[];
  readonly bar: Bar;
  readonly masterBar: MasterBar;
  readonly barIndex: number;
  /** The clef in effect for this bar: `Bar.clef` changes persist until the next one. */
  readonly clef: Clef;
  readonly keySignature: KeySignature;
  /** One staff space in px at the current zoom. */
  readonly space: number;
}

/** Room a staff needs around one onset, in px from the onset's x. */
export interface OnsetExtent {
  tick: number;
  left: number;
  right: number;
}

export interface StaffBarMeasure {
  /** Ticks into the bar of every onset this staff draws, each with the room it needs. */
  onsets: OnsetExtent[];
  /**
   * Room needed above the top line and below the bottom line, in px: what sits next to the
   * staff, inside the lanes.
   */
  above: number;
  below: number;
}

/** A neighbouring bar of the same staff in the same system: its content area and onset positions. */
export interface NeighbourBar {
  readonly x: number;
  readonly width: number;
  onsetX(tick: number): number;
}

/** Where the engine put the bar: the module draws inside this. */
export interface StaffBarPlacement {
  /** The bar's content area, after its signatures and before its end bar line. */
  readonly x: number;
  readonly width: number;
  /** y of the top and bottom staff lines. */
  readonly top: number;
  readonly bottom: number;
  readonly geometry: StaffGeometry;
  readonly system: number;
  /** x of the onset `tick` ticks into the bar; an onset the module measured always has one. */
  onsetX(tick: number): number;
  /**
   * The bars before and after this one in the system, for ties, slides and extents that cross
   * the bar line; absent at the system's ends, so a module can tell a bar line from a break.
   */
  readonly previous?: NeighbourBar;
  readonly next?: NeighbourBar;
  /** Where each lane this system has on this staff lies; a module draws a lane's items only into its band. */
  readonly lanes: LaneBands;
  /** The bar opens a line: a paged system's first bar, or the first bar of the continuous line. */
  readonly lineStart: boolean;
}

/**
 * What a staff type contributes to layout. The engine owns horizontal spacing, systems and the
 * furniture shared by every staff (lines, bar lines, clefs, signatures); a module measures and
 * draws a bar's content within the width the engine allots.
 */
export interface StaffModule {
  readonly type: StaffType;
  /** Room kept around the lines whatever the bars hold, in staff spaces. */
  readonly minRoom: { above: number; below: number };
  geometry(track: Track, space: number): StaffGeometry;
  /** Horizontal room and the room next to the staff. Reads this bar only, so the engine caches it. */
  measure(input: StaffBar): StaffBarMeasure;
  /** The lanes the bar draws into and their heights. Reads this bar and the dynamic entering it. */
  lanes(input: StaffBar): LaneRequests;
  /**
   * Reads its own track's bars up to `BAR_REACH` either side (ties, slides, runs across bar
   * lines), the master bars one either side, and the dynamic entering this bar; nothing else of
   * other bars.
   */
  render(input: StaffBar, placement: StaffBarPlacement, sink: LayoutSink): void;
}
