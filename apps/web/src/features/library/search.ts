import { z } from 'zod';

import { defineSetting } from '@/state/settings';

import type { SongRow } from './db/rows';

export const SORTS = ['title', 'artist', 'lastOpened', 'imported'] as const;
export type SortKey = (typeof SORTS)[number];

/** The library's sort; the row key is the one the library has always used, so no data moves. */
export const LIBRARY_SORT_SETTING = defineSetting({
  key: 'library.sort',
  schema: z.enum(SORTS),
  default: 'title',
});

export function isSortKey(value: unknown): value is SortKey {
  return SORTS.some((key) => key === value);
}

export interface LibraryEntry {
  row: SongRow;
  /** Title, artist and album folded once, so a keystroke only runs `includes`. */
  haystack: string;
}

/** Lower-cased, accents stripped, so "Beyoncé" is found by "beyonce". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function entryOf(row: SongRow): LibraryEntry {
  return { row, haystack: fold(`${row.title}\n${row.artist}\n${row.album}`) };
}

/** Every whitespace-separated token has to occur somewhere in the song's title, artist or album. */
export function filterEntries(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const tokens = fold(query).split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [...entries];
  return entries.filter(({ haystack }) => tokens.every((token) => haystack.includes(token)));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function byText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Never mutates `entries`; ties fall back to title, then to import time. */
export function sortEntries(entries: readonly LibraryEntry[], key: SortKey): LibraryEntry[] {
  const primary = (a: SongRow, b: SongRow): number => {
    switch (key) {
      case 'title':
        return 0;
      case 'artist':
        return byText(a.artist, b.artist);
      // Never-opened songs sort after every opened one, newest first.
      case 'lastOpened':
        return (b.lastOpenedAt ?? -1) - (a.lastOpenedAt ?? -1);
      case 'imported':
        return b.importedAt - a.importedAt;
    }
  };
  return [...entries].sort(
    (a, b) =>
      primary(a.row, b.row) ||
      byText(a.row.title, b.row.title) ||
      a.row.importedAt - b.row.importedAt,
  );
}
