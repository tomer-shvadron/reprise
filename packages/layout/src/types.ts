import type { Id, Notation } from '@reprise/model';

import type { GlyphName } from './metrics';

/** A rectangle in layout space: CSS px, origin at the top left of the first page, y down. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The colour slot a primitive is painted with, resolved by the painter from the theme. */
export type ThemeRole = 'ink' | 'paper' | 'accent' | 'muted';

export type StaffType = 'tab' | 'standard' | 'percussion';

/** How a tab staff writes a note tied from the one before it: its fret in parentheses, or nothing but the tie. */
export type TiedNotes = 'parentheses' | 'hidden';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutOptions {
  mode: 'paged' | 'continuous';
  /** Paged: the page width. Continuous: the viewport width, the target width of each system. */
  width: number;
  /** Paged only; defaults to the A4 height. */
  pageHeight?: number;
  /** Scales the notation (staff space, text, gaps); page size and margins stay as given. */
  zoom: number;
  tracks: Id[] | 'all';
  /** Per-track override of `Track.display.notation`. Drum tracks always show a percussion staff. */
  notation: Record<Id, Notation>;
  /** Tied notes on tab staves; `parentheses` unless given. */
  tiedNotes?: TiedNotes;
  /** Page margins, unscaled; see `DEFAULT_MARGINS`. */
  margins?: Partial<Margins>;
  /** Vertical space between stacked pages in paged mode, unscaled. */
  pageGap?: number;
  /** Space between the staves of one track (standard above tab), at zoom 1. */
  staffGap?: number;
  /** Space between the staff groups of two tracks, at zoom 1. */
  trackGap?: number;
  /** Space between systems in paged mode, at zoom 1. */
  systemGap?: number;
  /** Master-bar ids to re-measure when a cache is given, usually `Change.touchedBars`. */
  dirtyBars?: readonly Id[];
}

interface PrimitiveBase {
  x: number;
  y: number;
  bbox: Rect;
  role: ThemeRole;
  /** The model node drawn: a master bar, track, bar, beat or note id. */
  node?: Id;
}

/** A SMuFL glyph from Bravura; (x, y) is the glyph origin on its baseline. */
export interface GlyphPrimitive extends PrimitiveBase {
  kind: 'glyph';
  glyph: GlyphName;
  codepoint: number;
  /** Font size in px; one staff space is a quarter of it. */
  size: number;
}

/** A straight stroke from (x, y) to (x2, y2). */
export interface LinePrimitive extends PrimitiveBase {
  kind: 'line';
  x2: number;
  y2: number;
  thickness: number;
  /** Dash and gap lengths, for a dashed stroke. */
  dash?: [number, number];
}

/** An SVG path in layout coordinates; filled with the role colour, or stroked when `fill` is false. */
export interface PathPrimitive extends PrimitiveBase {
  kind: 'path';
  d: string;
  fill: boolean;
  thickness: number;
}

/** UI-font text; (x, y) is the baseline point `anchor` refers to. */
export interface TextPrimitive extends PrimitiveBase {
  kind: 'text';
  text: string;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  italic: boolean;
}

export type Primitive = GlyphPrimitive | LinePrimitive | PathPrimitive | TextPrimitive;

export type AnchorKind = 'note' | 'beat' | 'bar' | 'staff' | 'system';

/**
 * A model node's hit box. `bar` anchors exist for each track's `Bar` (with `track`) and for the
 * master bar's whole column (without); `staff` anchors are keyed by track id, one per staff and
 * system; `system` anchors by the system id.
 */
export interface Anchor {
  kind: AnchorKind;
  id: Id;
  bbox: Rect;
  system: number;
  track?: Id;
  staff?: StaffType;
  voice?: number;
  masterBar?: Id;
}

/** Half-open index range into one of the result's flat arrays. */
export interface Range {
  start: number;
  end: number;
}

export interface StaffPlacement {
  track: Id;
  type: StaffType;
  /** y of the top and bottom staff lines. */
  top: number;
  bottom: number;
}

export interface System {
  /** Stable across re-layouts while the system starts at the same bar: `system:<masterBarId>`. */
  id: string;
  index: number;
  page: number;
  /** Master-bar indices, end exclusive. */
  bars: Range;
  bbox: Rect;
  staves: StaffPlacement[];
  primitives: Range;
  anchors: Range;
}

export interface Page {
  index: number;
  /** The page rectangle in layout space; pages stack vertically, `pageGap` apart. */
  bbox: Rect;
  systems: Range;
}

export interface LayoutMetrics {
  /** Wall-clock time of the call; the one field that differs between identical calls. */
  layoutMs: number;
  primitives: number;
  anchors: number;
  /** Bars measured by this call rather than taken from the cache. */
  measuredBars: number;
  /** Systems carried over unchanged from the cache. */
  reusedSystems: number;
}

export interface LayoutResult {
  pages: Page[];
  systems: System[];
  /** Ordered by system, so `System.primitives` slices them. */
  primitives: Primitive[];
  /** Ordered by system, so `System.anchors` slices them. */
  anchors: Anchor[];
  metrics: LayoutMetrics;
}
