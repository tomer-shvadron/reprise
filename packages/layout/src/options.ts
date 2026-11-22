import { shownNotation, type Id, type Notation, type Score, type Track } from '@reprise/model';

import type { LayoutOptions, Margins, StaffType, TiedNotes } from './types';

/** Paper sizes in CSS px at 96 dpi. */
export const PAGE_SIZES = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const;

export const DEFAULT_MARGINS: Readonly<Record<LayoutOptions['mode'], Margins>> = {
  paged: { top: 48, right: 48, bottom: 48, left: 48 },
  continuous: { top: 16, right: 16, bottom: 16, left: 16 },
};

/** One staff space at zoom 1, in px: the distance between two lines of a standard staff. */
export const STAFF_SPACE = 7;

const DEFAULT_GAPS = { pageGap: 32, staffGap: 12, trackGap: 24, systemGap: 32 };

export interface VisibleTrack {
  track: Track;
  index: number;
  staves: StaffType[];
}

export interface ResolvedOptions {
  mode: LayoutOptions['mode'];
  width: number;
  pageHeight: number;
  margins: Margins;
  /** Paged: the room above the first page's systems for the caller's header; 0 in continuous mode. */
  headerHeight: number;
  pageGap: number;
  space: number;
  staffGap: number;
  trackGap: number;
  systemGap: number;
  tracks: VisibleTrack[];
  tiedNotes: TiedNotes;
  chordDiagrams: boolean;
  /** `LayoutOptions.verticalReach`; `Infinity` when unset. Not part of any key, as `dirtyBars` is not. */
  verticalReach: number;
  /** Everything a cached bar measurement depends on besides the bars themselves. */
  measureKey: string;
  /** Everything else a cached system depends on. */
  systemKey: string;
}

/**
 * The staves a track shows, top to bottom. Drums always read from a percussion staff, and a track
 * that cannot show tab (`canShowTab`) falls back to standard notation whatever it asks for.
 */
export function stavesFor(track: Track, notation: Notation): StaffType[] {
  if (track.kind === 'drums') return ['percussion'];
  switch (shownNotation(track, notation)) {
    case 'tab':
      return ['tab'];
    case 'both':
      return ['standard', 'tab'];
    case 'standard':
      return ['standard'];
  }
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`layout option ${name} must be a positive number`);
  }
  return value;
}

/**
 * `verticalReach` of an edit that changes the continuous vertical layout: the segments nearest the
 * edit, redrawn besides the ones `verticalWindow` names (what the view has mounted). Without a
 * window (no view) it is the whole guarantee: about the mounted range around the edit at zoom 1
 * on a pane up to about 1 900 px; a wider pane or a zoom below 1 needs the window.
 */
export const VERTICAL_EDIT_REACH = 8;

/**
 * `verticalReach` of the follow-up calls that redraw the remaining stale segments, one per timer
 * turn. Chosen so one call stays well inside a frame on the long score in mixed notation (see
 * "Re-layout follow-up call, continuous" in the budgets table); every call also pays the base
 * cost of a cached layout, so a smaller value only lengthens convergence.
 */
export const VERTICAL_FOLLOW_UP_REACH = 8;

function reach(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `layout option verticalReach (${String(value)}) must be a non-negative integer`,
    );
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`layout option ${name} must be a non-negative number`);
  }
  return value;
}

export function resolveOptions(score: Score, options: LayoutOptions): ResolvedOptions {
  const zoom = positive(options.zoom, 'zoom');
  const width = positive(options.width, 'width');
  const pageHeight = positive(options.pageHeight ?? PAGE_SIZES.a4.height, 'pageHeight');
  const wanted: ReadonlySet<Id> | undefined =
    options.tracks === 'all' ? undefined : new Set(options.tracks);
  const tracks = score.tracks.flatMap((track, index): VisibleTrack[] =>
    wanted && !wanted.has(track.id)
      ? []
      : [
          {
            track,
            index,
            staves: stavesFor(track, options.notation[track.id] ?? track.display.notation),
          },
        ],
  );
  const gaps = {
    staffGap: (options.staffGap ?? DEFAULT_GAPS.staffGap) * zoom,
    trackGap: (options.trackGap ?? DEFAULT_GAPS.trackGap) * zoom,
    systemGap: (options.systemGap ?? DEFAULT_GAPS.systemGap) * zoom,
  };
  const space = STAFF_SPACE * zoom;
  const trackKey = tracks.map(({ track, staves }) => [
    track.id,
    staves,
    track.kind,
    track.tuning,
    track.capo,
    track.fretCount,
    track.drone ?? null,
    track.display.clef ?? '',
    track.display.octaveShift,
  ]);
  const nameKey = tracks.map(({ track }) => [track.name, track.shortName]);
  const margins = { ...DEFAULT_MARGINS[options.mode], ...options.margins };
  const headerHeight =
    options.mode === 'paged' ? nonNegative(options.headerHeight ?? 0, 'headerHeight') : 0;
  const room = pageHeight - margins.top - margins.bottom;
  if (headerHeight > 0 && headerHeight >= room) {
    throw new RangeError(
      `layout option headerHeight (${String(headerHeight)}) must be less than the first page's content area (${String(room)})`,
    );
  }
  const pageGap = options.pageGap ?? DEFAULT_GAPS.pageGap;
  const tiedNotes = options.tiedNotes ?? 'parentheses';
  const chordDiagrams = options.chordDiagrams ?? true;
  const measureKey = JSON.stringify([space, tiedNotes, chordDiagrams, trackKey]);
  return {
    mode: options.mode,
    width,
    pageHeight,
    margins,
    headerHeight,
    pageGap,
    space,
    ...gaps,
    tracks,
    tiedNotes,
    chordDiagrams,
    verticalReach: options.verticalReach === undefined ? Infinity : reach(options.verticalReach),
    measureKey,
    systemKey: JSON.stringify([
      measureKey,
      nameKey,
      options.mode,
      width,
      pageHeight,
      margins,
      headerHeight,
      pageGap,
      gaps,
    ]),
  };
}
