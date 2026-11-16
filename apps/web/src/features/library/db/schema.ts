import { Dexie, type EntityTable } from 'dexie';

import type { PracticeSessionRow } from '@/features/trainer';

import type { SettingRow, SongRow } from './rows';

export const DB_NAME = 'reprise';

export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  /** Only for a change the new stores cannot express, such as filling a field. */
  upgrade?: Parameters<ReturnType<Dexie['version']>['upgrade']>[0];
}

/**
 * Append-only: a shipped version is never edited, because a user's database may be at any of
 * them. WP-073 appends version 2 with its `practiceSessions` table.
 */
export const SCHEMA: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      songs: 'id, &originalKey, title, artist, importedAt, lastOpenedAt',
      settings: 'key',
    },
  },
  // WP-073. `[songId+startedAt]` serves one song's sessions in order. There is deliberately no
  // lone `startedAt` index: a weekly summary would add one in version 3.
  { version: 2, stores: { practiceSessions: 'id, [songId+startedAt]' } },
];

export type RepriseDb = Dexie & {
  songs: EntityTable<SongRow, 'id'>;
  settings: EntityTable<SettingRow, 'key'>;
  practiceSessions: EntityTable<PracticeSessionRow, 'id'>;
};

/** Opens (lazily, on first query) the library database with every `schema` entry applied in order. */
export function openLibraryDb(
  name: string = DB_NAME,
  schema: readonly SchemaVersion[] = SCHEMA,
): RepriseDb {
  const db = new Dexie(name);
  for (const { version, stores, upgrade } of schema) {
    const declared = db.version(version).stores(stores);
    if (upgrade) declared.upgrade(upgrade);
  }
  // Dexie adds each declared table as a property; the cast is that structural fact.
  return db as RepriseDb;
}
