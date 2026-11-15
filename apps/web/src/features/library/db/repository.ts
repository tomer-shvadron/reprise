import type { Id } from '@reprise/model';

import type { TrackSession } from '@/features/tracks';

import { SongRowSchema, type SongRow } from './rows';
import type { RepriseDb } from './schema';

export interface SongsRepository {
  /** Every valid row; a row that fails its schema is skipped and logged, never thrown. */
  all(): Promise<SongRow[]>;
  get(id: Id): Promise<SongRow | undefined>;
  /** The song already imported from bytes with this hash, if any. */
  byKey(originalKey: string): Promise<SongRow | undefined>;
  /** Rejects when the id or the key is taken. */
  add(row: SongRow): Promise<void>;
  remove(id: Id): Promise<void>;
  setSession(id: Id, session: TrackSession): Promise<void>;
  touch(id: Id, openedAt: number): Promise<void>;
  /** Most recently opened first; never-opened songs are not listed. */
  recents(limit: number): Promise<SongRow[]>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
}

function valid(raw: unknown): SongRow | undefined {
  const parsed = SongRowSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.warn('Skipped a library row that does not match its schema', parsed.error.issues);
  return undefined;
}

export function createSongsRepository(db: RepriseDb): SongsRepository {
  return {
    async all() {
      const raw = await db.songs.toArray();
      return raw.flatMap((row) => valid(row) ?? []);
    },
    async get(id) {
      const raw = await db.songs.get(id);
      return raw === undefined ? undefined : valid(raw);
    },
    async byKey(originalKey) {
      const raw = await db.songs.where('originalKey').equals(originalKey).first();
      return raw === undefined ? undefined : valid(raw);
    },
    async add(row) {
      await db.songs.add(row);
    },
    async remove(id) {
      await db.songs.delete(id);
    },
    async setSession(id, session) {
      await db.songs.update(id, { session });
    },
    async touch(id, openedAt) {
      await db.songs.update(id, { lastOpenedAt: openedAt });
    },
    async recents(limit) {
      const raw = await db.songs.orderBy('lastOpenedAt').reverse().limit(limit).toArray();
      return raw.flatMap((row) => valid(row) ?? []);
    },
    async getSetting(key) {
      return (await db.settings.get(key))?.value;
    },
    async setSetting(key, value) {
      await db.settings.put({ key, value });
    },
  };
}
