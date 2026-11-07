import { layout, type LayoutOptions, type LayoutResult } from '@reprise/layout';
import type { Id, Notation, Score, ScoreMeta } from '@reprise/model';

import { viewLayoutOptions, type PaperSize } from './view-options';

export interface PrintSettings {
  /** In score order, at least one. */
  tracks: readonly Id[];
  paper: PaperSize;
  header: boolean;
  pageNumbers: boolean;
}

export interface PrintHeading {
  title?: string;
  byline?: string;
  /** The room layout keeps for it on the first page, its gap to the first system included. */
  height: number;
}

export const PRINT_HEADING = {
  titleSize: 22,
  titleLine: 30,
  bylineSize: 13,
  bylineLine: 20,
  gap: 18,
} as const;

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The title, else the file name; `artist — album` or either alone; undefined with neither line. */
export function printHeading(
  meta: Pick<ScoreMeta, 'title' | 'artist' | 'album'>,
  fileName: string | undefined,
): PrintHeading | undefined {
  const title = meta.title.trim() || withoutExtension(fileName?.trim() ?? '');
  const byline = [meta.artist.trim(), meta.album.trim()].filter(Boolean).join(' — ');
  if (!title && !byline) return undefined;
  const height =
    (title ? PRINT_HEADING.titleLine : 0) +
    (byline ? PRINT_HEADING.bylineLine : 0) +
    PRINT_HEADING.gap;
  return { ...(title && { title }), ...(byline && { byline }), height };
}

export function printLayoutOptions(
  settings: PrintSettings,
  notation: Record<Id, Notation>,
  headerHeight: number,
): LayoutOptions {
  return {
    ...viewLayoutOptions(
      { mode: 'paged', paper: settings.paper },
      { tracks: [...settings.tracks], notation },
    ),
    ...(headerHeight > 0 && { headerHeight }),
  };
}

export interface PrintContent {
  result: LayoutResult;
  settings: PrintSettings;
  heading: PrintHeading | undefined;
}

/**
 * The print layout pass: cold, at the paper's size and zoom 1, whatever the screen shows. The one
 * way in, for the print store and the demo alike.
 */
export function layoutForPrint(
  score: Score,
  settings: PrintSettings,
  notation: Record<Id, Notation>,
  fileName: string | undefined,
  run: typeof layout = layout,
): PrintContent {
  const present = new Set(score.tracks.map(({ id }) => id));
  const kept = { ...settings, tracks: settings.tracks.filter((id) => present.has(id)) };
  const heading = settings.header ? printHeading(score.meta, fileName) : undefined;
  const result = run(score, printLayoutOptions(kept, notation, heading?.height ?? 0));
  return { result, settings: kept, heading };
}
