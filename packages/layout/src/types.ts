import type { Id, Notation } from '@reprise/model';

import type { GlyphName } from './metrics';

/** A rectangle in CSS px, y down; in layout space (origin at the top left of the first page) unless its owner says otherwise. */
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
  /** Paged: the page width. Continuous: the target width of each segment (the painter passes 640). */
  width: number;
  /** Paged only; defaults to the A4 height. */
  pageHeight?: number;
  /** Scales the notation (staff space, text, gaps); page size and margins stay as given. */
  zoom: number;
  tracks: Id[] | 'all';
  /**
   * Per-track override of `Track.display.notation`. Drum tracks always show a percussion staff, and
   * a track that cannot show tab (`canShowTab`) a standard one.
   */
  notation: Record<Id, Notation>;
  /** Tied notes on tab staves; `parentheses` unless given. */
  tiedNotes?: TiedNotes;
  /** Draw a chord's grid under its name where the file has one; true unless given. */
  chordDiagrams?: boolean;
  /** Page margins, unscaled; see `DEFAULT_MARGINS`. */
  margins?: Partial<Margins>;
  /**
   * Paged only: the height kept free at the top of the first page's content area, under the top
   * margin, for a header the caller draws (a print's title). Unscaled; 0 unless given.
   */
  headerHeight?: number;
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
  /**
   * Continuous mode with a cache: when the shared vertical layout changes (a staff's extents, a
   * lane appearing or growing), at most this many unedited segments, nearest the edit, are
   * redrawn for it in this call; the others keep their previous drawing, stale, until a later
   * call redraws them (see `LayoutMetrics.staleSystems`). Unset: every segment, as without it.
   * Paged mode and a call without a cache ignore it.
   */
  verticalReach?: number | undefined;
}

/** In layout coordinates, or in the segment's own frame in continuous mode (see `System.offsetX`). */
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

/** An SVG path in its system's coordinates; filled with the role colour, or stroked when `fill` is false. */
export interface PathPrimitive extends PrimitiveBase {
  kind: 'path';
  d: string;
  fill: boolean;
  thickness: number;
  /**
   * `section` on a section marker's enclosure box, so a right-click on its padding finds the
   * marker; `chordDiagram` on a chord diagram's grid, whose box is the whole diagram's.
   */
  lane?: 'section' | 'chordDiagram';
}

/** The row a word primitive sits in: a chord name, beat text, or lyric line `n` (0 to 4, as `lyric:0`). */
export type WordLane = 'chord' | 'text' | `lyric:${number}`;

/** UI-font text; (x, y) is the baseline point `anchor` refers to. */
export interface TextPrimitive extends PrimitiveBase {
  kind: 'text';
  /**
   * Set on chord names, beat text and syllables, so an editor finds a word's row without guessing
   * from y, and on a section marker's text, which tempo text (also keyed by the master bar) lacks.
   */
  lane?: WordLane | 'section';
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
 * system; `system` anchors by the system id. `bbox` is in its system's frame (`anchorBox` gives
 * layout space).
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
  /** Where this staff's words go, present on the staff that draws them (the tab, else the only staff), empty rows included. */
  words?: WordBaselines;
}

/** Baselines, in layout space, of the word rows beside a staff; they hold even where the row is empty. */
export interface WordBaselines {
  /** Font size of a word in px. */
  size: number;
  /** The chord row's baseline: where a chord name goes now, or would go if the bar had one. */
  chord: number;
  /** The beat text row's baseline, likewise. */
  text: number;
  /** The baseline of lyric line 0; line n sits `n * lyricRow` lower. */
  lyrics: number;
  lyricRow: number;
}

export interface System {
  /**
   * Stable across re-layouts while the system starts at the same bar: `system:<masterBarId>`, and
   * `system:<masterBarId>/<part>` for a split system's parts after the first.
   */
  id: string;
  index: number;
  /**
   * On every part of a system split across pages: 0, 1, …; absent on a whole system. Parts follow
   * each other in `systems` and share `bars`.
   */
  part?: number;
  page: number;
  /** Master-bar indices, end exclusive. */
  bars: Range;
  /** In layout space. */
  bbox: Rect;
  /**
   * Continuous mode only: how far right of the left margin this segment sits. Its primitives and
   * anchor boxes are drawn as if it began the line at the left margin, so layout-space x = x +
   * `offsetX`. `bbox` and `staves` are in layout space.
   */
  offsetX?: number;
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
  /**
   * Segments (parts) still drawn with an older vertical layout, because of `verticalReach`; 0 in
   * paged mode and when the option is unset.
   */
  staleSystems: number;
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
