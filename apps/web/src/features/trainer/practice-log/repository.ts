import type { Id } from '@reprise/model';
import type { EntityTable } from 'dexie';

import { PracticeSessionRowSchema, type PracticeSessionRow } from './row';

/** The `practiceSessions` table; the shell passes the library database's. */
export type PracticeTable = EntityTable<PracticeSessionRow, 'id'>;

export interface PracticeRepository {
  /** Inserts or replaces the session's row. */
  put(row: PracticeSessionRow): Promise<void>;
  /** The song's valid rows, oldest first; a row that fails its schema is skipped and logged. */
  forSong(songId: Id): Promise<PracticeSessionRow[]>;
}

export function createPracticeRepository(table: PracticeTable): PracticeRepository {
  return {
    async put(row) {
      await table.put(row);
    },
    async forSong(songId) {
      const raw = await table
        .where('[songId+startedAt]')
        .between([songId, -Infinity], [songId, Infinity])
        .toArray();
      return raw.flatMap((row) => {
        const parsed = PracticeSessionRowSchema.safeParse(row);
        if (parsed.success) return parsed.data;
        console.warn('Skipped a practice row that does not match its schema', parsed.error.issues);
        return [];
      });
    },
  };
}
