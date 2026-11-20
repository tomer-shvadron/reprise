import type { RecentSong } from '@/platform/platform';
import { MAX_RECENT_SONGS } from '@/platform/platform';

import type { SongRow } from './db/rows';
import type { LibraryEntry } from './search';

/** The title a song is listed under: its file name when the title is blank. */
export function songTitle(row: Pick<SongRow, 'title' | 'originalName'>): string {
  return row.title.trim() === '' ? row.originalName : row.title;
}

/** The songs that have been opened, most recent first. */
export function recentOf(entries: readonly LibraryEntry[], limit: number): LibraryEntry[] {
  return entries
    .filter((entry) => entry.row.lastOpenedAt !== undefined)
    .sort((a, b) => (b.row.lastOpenedAt ?? 0) - (a.row.lastOpenedAt ?? 0))
    .slice(0, limit);
}

/** What the native File menu's Open Recent shows. */
export function recentMenuOf(entries: readonly LibraryEntry[]): RecentSong[] {
  return recentOf(entries, MAX_RECENT_SONGS).map(({ row }) => ({
    id: row.id,
    title: songTitle(row),
  }));
}
