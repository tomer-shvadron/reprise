import type { Id } from '@reprise/model';

import { songTitle } from './recents';
import { filterEntries, fold, type LibraryEntry } from './search';

export interface RankedSong {
  id: Id;
  label: string;
  /** "Artist · Album" with the empty parts dropped. */
  detail: string;
  open: boolean;
}

export interface RankedSongs {
  rows: RankedSong[];
  /** Matches before the cap, for the "Showing 50 of N" note. */
  total: number;
}

export const SONG_LIMIT = 50;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The palette's `/` list. Empty query: opened songs by last opened, then the rest by title. With a
 * query: title-prefix matches first, then last opened, then title. Capped, so a large library never
 * puts thousands of items in the list.
 */
export function rankSongs(
  entries: readonly LibraryEntry[],
  query: string,
  openSongId: Id | undefined,
  limit = SONG_LIMIT,
): RankedSongs {
  const wanted = fold(query).trim();
  const tokens = wanted.split(/\s+/u).filter(Boolean);
  // A blank title is listed by its file name, so the file name is searchable too.
  const matched = [
    ...new Set([
      ...filterEntries(entries, query),
      ...entries.filter(
        ({ row }) =>
          row.title.trim() === '' &&
          tokens.length > 0 &&
          tokens.every((token) => fold(row.originalName).includes(token)),
      ),
    ]),
  ];
  const prefixed = (entry: LibraryEntry) =>
    wanted !== '' && fold(songTitle(entry.row)).startsWith(wanted) ? 0 : 1;
  const opened = (entry: LibraryEntry) => entry.row.lastOpenedAt ?? -1;
  const sorted = matched.sort((a, b) => {
    if (wanted === '') {
      const aOpened = a.row.lastOpenedAt !== undefined;
      const bOpened = b.row.lastOpenedAt !== undefined;
      if (aOpened !== bOpened) return aOpened ? -1 : 1;
    } else if (prefixed(a) !== prefixed(b)) {
      return prefixed(a) - prefixed(b);
    }
    return opened(b) - opened(a) || collator.compare(songTitle(a.row), songTitle(b.row));
  });
  return {
    total: sorted.length,
    rows: sorted.slice(0, limit).map(({ row }) => ({
      id: row.id,
      label: songTitle(row),
      detail: [row.artist, row.album].filter((part) => part.trim() !== '').join(' · '),
      open: row.id === openSongId,
    })),
  };
}
