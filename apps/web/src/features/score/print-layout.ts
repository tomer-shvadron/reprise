import {
  layout,
  PAGE_SIZES,
  DEFAULT_MARGINS,
  type LayoutOptions,
  type LayoutResult,
} from '@reprise/layout';
import type { Id, Notation, Score, ScoreMeta } from '@reprise/model';

import { chordList } from '@/lib/chords';

import { stripLayout, type PrintStrip } from './chord-strip-layout';
import { viewLayoutOptions, type ContentOptions, type PaperSize } from './view-options';

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
  /** The chord strip (#352), under the lines of text, when it is on and the track has chords. */
  strip?: PrintStrip;
  /** Where the strip starts, from the top of the heading's box: under the title and byline. */
  stripTop?: number;
  /** The room layout keeps for it on the first page, its gap to the first system included. */
  height: number;
}

export const PRINT_HEADING = {
  titleSize: 22,
  titleLine: 30,
  bylineSize: 13,
  bylineLine: 20,
  gap: 18,
  stripGap: 8,
} as const;

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The title, else the file name; `artist — album` or either alone; undefined with neither line. */
export function printHeading(
  meta: Pick<ScoreMeta, 'title' | 'artist' | 'album'>,
  fileName: string | undefined,
  strip?: PrintStrip,
): PrintHeading | undefined {
  const title = meta.title.trim() || withoutExtension(fileName?.trim() ?? '');
  const byline = [meta.artist.trim(), meta.album.trim()].filter(Boolean).join(' — ');
  if (!title && !byline && !strip) return undefined;
  const stripTop = (title ? PRINT_HEADING.titleLine : 0) + (byline ? PRINT_HEADING.bylineLine : 0);
  // The strip sits a little under the text, not against it.
  const stripRoom = strip ? strip.height + (stripTop > 0 ? PRINT_HEADING.stripGap : 0) : 0;
  return {
    ...(title && { title }),
    ...(byline && { byline }),
    ...(strip && { strip }),
    ...(strip && { stripTop: stripTop + (stripTop > 0 ? PRINT_HEADING.stripGap : 0) }),
    height: stripTop + stripRoom + PRINT_HEADING.gap,
  };
}

export function printLayoutOptions(
  settings: PrintSettings,
  notation: Record<Id, Notation>,
  headerHeight: number,
  content: Pick<ContentOptions, 'chordDiagrams' | 'tiedNotes'> = {},
): LayoutOptions {
  return {
    ...viewLayoutOptions(
      { mode: 'paged', paper: settings.paper },
      {
        tracks: [...settings.tracks],
        notation,
        ...content,
      },
    ),
    ...(headerHeight > 0 && { headerHeight }),
  };
}

/** What the screen's settings choose for a print or an export. */
export type PrintContentOptions = Pick<ContentOptions, 'chordDiagrams' | 'tiedNotes'> & {
  /** Draw the chord strip under the title (#352). */
  chordStrip?: boolean;
  /** The track current on screen, which the strip prefers when it is printed. */
  currentTrack?: Id | undefined;
};

export interface PrintContent {
  result: LayoutResult;
  settings: PrintSettings;
  heading: PrintHeading | undefined;
}

/**
 * The strip of one printed track's chords, across the page's content width: the track current on
 * screen when it is printed and has chords, so the page matches the screen, else the first
 * printed track that has any.
 */
function stripOf(
  score: Score,
  settings: PrintSettings,
  current: Id | undefined,
): PrintStrip | undefined {
  const printed = settings.tracks.flatMap((id) => score.tracks.find((t) => t.id === id) ?? []);
  const track =
    printed.find((t) => t.id === current && chordList(t).length > 0) ??
    printed.find((t) => chordList(t).length > 0) ??
    printed[0];
  const margins = DEFAULT_MARGINS.paged;
  const width = PAGE_SIZES[settings.paper].width - margins.left - margins.right;
  return stripLayout(chordList(track), width);
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
  /** `run` is the layout function, for tests; the rest is what the screen's settings choose. */
  {
    run = layout,
    chordStrip = false,
    currentTrack,
    ...content
  }: { run?: typeof layout } & PrintContentOptions = {},
): PrintContent {
  const present = new Set(score.tracks.map(({ id }) => id));
  const kept = { ...settings, tracks: settings.tracks.filter((id) => present.has(id)) };
  const strip = chordStrip ? stripOf(score, kept, currentTrack) : undefined;
  const heading = settings.header
    ? printHeading(score.meta, fileName, strip)
    : printHeading({ title: '', artist: '', album: '' }, undefined, strip);
  const result = run(score, printLayoutOptions(kept, notation, heading?.height ?? 0, content));
  return { result, settings: kept, heading };
}
