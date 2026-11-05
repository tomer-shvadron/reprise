import type { Bar, Clef, KeySignature, MasterBar, Score, Track } from '@reprise/model';

import type { LayoutSink } from '../primitives';
import type { StaffType } from '../types';

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
  /** Room needed above the top line and below the bottom line, in px. */
  above: number;
  below: number;
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
}

/**
 * What a staff type contributes to layout. The engine owns horizontal spacing, systems and the
 * furniture shared by every staff (lines, bar lines, clefs, signatures); a module measures and
 * draws a bar's content within the width the engine allots.
 */
export interface StaffModule {
  readonly type: StaffType;
  geometry(track: Track, space: number): StaffGeometry;
  measure(input: StaffBar): StaffBarMeasure;
  render(input: StaffBar, placement: StaffBarPlacement, sink: LayoutSink): void;
}
