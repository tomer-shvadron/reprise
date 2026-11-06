import { PAGE_SIZES, type LayoutOptions } from '@reprise/layout';
import type { Notation, Score } from '@reprise/model';

/**
 * Continuous mode lays out in fixed segments rather than at the viewport width: a segment as wide
 * as a 1 920 px viewport at zoom 0.5 holds ~9 000 primitives, and three or four mounted ones
 * break the 20 000-element budget. The segments join seamlessly, so the width is invisible.
 */
export const CONTINUOUS_SYSTEM_WIDTH = 640;

export type PaperSize = keyof typeof PAGE_SIZES;

export interface ViewSettings {
  mode: LayoutOptions['mode'];
  paper: PaperSize;
}

export type ContentOptions = Pick<LayoutOptions, 'tracks' | 'notation' | 'tiedNotes'>;

/** Layout options for a view. Zoom is always 1: the painter scales, layout never re-runs on zoom. */
export function viewLayoutOptions(view: ViewSettings, content: ContentOptions): LayoutOptions {
  const { tracks, notation, tiedNotes } = content;
  const shared = { zoom: 1, tracks, notation, ...(tiedNotes !== undefined && { tiedNotes }) };
  if (view.mode === 'continuous') {
    return { mode: 'continuous', width: CONTINUOUS_SYSTEM_WIDTH, ...shared };
  }
  const { width, height } = PAGE_SIZES[view.paper];
  return { mode: 'paged', width, pageHeight: height, ...shared };
}

/** One notation for every track, or `default` for each track's own. */
export type NotationChoice = Notation | 'default';

export function uniformNotation(score: Score, notation: NotationChoice): LayoutOptions['notation'] {
  return notation === 'default'
    ? {}
    : Object.fromEntries(score.tracks.map(({ id }) => [id, notation]));
}
