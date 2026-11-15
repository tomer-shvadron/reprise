import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { rowOf, uniqueDbName } from '../test-support';

import { SongRowSchema } from './rows';
import { openLibraryDb, SCHEMA, type SchemaVersion } from './schema';

const open: Dexie[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** The database as a user who last ran with `schema` left it. */
async function writeAt(name: string, schema: readonly SchemaVersion[], rows: unknown[]) {
  const db = openLibraryDb(name, schema);
  open.push(db);
  await db.table('songs').bulkAdd(rows);
  await db.table('settings').put({ key: 'library.sort', value: 'artist' });
  db.close();
}

describe('the library schema', () => {
  it('declares strictly increasing versions from 1', () => {
    expect(SCHEMA.map((entry) => entry.version)).toEqual(SCHEMA.map((_, index) => index + 1));
  });

  it('creates the songs and settings tables with the indexes the screen and imports use', async () => {
    const db = openLibraryDb(uniqueDbName());
    open.push(db);
    await db.open();
    expect(db.tables.map((table) => table.name).sort()).toEqual(['settings', 'songs']);
    const songs = db.table('songs').schema;
    expect(songs.primKey.name).toBe('id');
    const unique = songs.indexes.filter((index) => index.unique).map((index) => index.name);
    expect(unique).toEqual(['originalKey']);
    expect(songs.indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['title', 'artist', 'importedAt', 'lastOpenedAt']),
    );
  });

  // The harness WP-073 extends: it walks every version a user's database can be at, reopens it
  // with the full SCHEMA and asserts nothing was lost. A new version adds its own sample rows
  // here and its tables to the expectation below.
  describe.each(SCHEMA.map((entry) => entry.version))('upgrading from version %i', (version) => {
    it('keeps every row and has every table of the current schema', async () => {
      const name = uniqueDbName();
      const rows = [rowOf(), rowOf({ lastOpenedAt: 5 })];
      await writeAt(name, SCHEMA.slice(0, version), rows);

      const db = openLibraryDb(name);
      open.push(db);
      const songs = await db.songs.toArray();
      expect(songs.map((song) => song.id).sort()).toEqual(rows.map((row) => row.id).sort());
      for (const song of songs) expect(SongRowSchema.safeParse(song).success).toBe(true);
      expect((await db.settings.get('library.sort'))?.value).toBe('artist');
      const expected = new Set(SCHEMA.flatMap((entry) => Object.keys(entry.stores)));
      expect(new Set(db.tables.map((table) => table.name))).toEqual(expected);
    });
  });

  it('applies a later version on top of version 1 without touching rows', async () => {
    const name = uniqueDbName();
    const rows = [rowOf(), rowOf()];
    await writeAt(name, SCHEMA, rows);
    const future: SchemaVersion[] = [
      ...SCHEMA,
      { version: 2, stores: { practiceSessions: 'id, songId, startedAt' } },
    ];
    const db = openLibraryDb(name, future);
    open.push(db);
    expect(await db.table('songs').count()).toBe(2);
    expect(db.tables.map((table) => table.name)).toContain('practiceSessions');
  });
});
