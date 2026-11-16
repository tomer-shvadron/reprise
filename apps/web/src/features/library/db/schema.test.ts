import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { uniqueDbName } from '../test-support';

import { SongRowSchema } from './rows';
import { openLibraryDb, SCHEMA, type SchemaVersion } from './schema';

const open: Dexie[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/**
 * What a database written at each version held, as literals that are never edited: a later
 * version that adds a field fills it in an `upgrade`, and rows built from the current shape would
 * hide a missing or wrong one. WP-073 appends its own entry when it appends its version.
 */
const SAMPLES: Record<
  number,
  { songs: unknown[]; settings: unknown[]; practiceSessions?: unknown[] }
> = {
  1: {
    songs: [
      {
        id: 'AAAAAAAAAAAA',
        title: 'First',
        artist: 'Ada',
        album: 'One',
        sourceFormat: 'gp5',
        nativePath: 'library/songs/AAAAAAAAAAAA.reprise',
        originalPath: 'library/originals/AAAAAAAAAAAA/first.gp5',
        originalName: 'first.gp5',
        originalKey: 'k1',
        importedAt: 1000,
        bars: 8,
        tracks: [{ name: 'Guitar' }],
      },
      {
        id: 'BBBBBBBBBBBB',
        title: 'Second',
        artist: 'Bo',
        album: '',
        sourceFormat: 'gpx',
        nativePath: 'library/songs/BBBBBBBBBBBB.reprise',
        originalPath: 'library/originals/BBBBBBBBBBBB/second.gpx',
        originalName: 'second.gpx',
        originalKey: 'k2',
        importedAt: 2000,
        lastOpenedAt: 3000,
        bars: 16,
        tracks: [{ name: 'Bass' }, { name: 'Drums' }],
        session: {
          version: 1,
          view: { tracks: 'all' },
          mixer: { CCCCCCCCCCCC: { mute: true } },
        },
      },
    ],
    settings: [{ key: 'library.sort', value: 'artist' }],
  },
  2: {
    get songs() {
      return SAMPLES[1]?.songs ?? [];
    },
    get settings() {
      return SAMPLES[1]?.settings ?? [];
    },
    practiceSessions: [
      {
        id: 'SSSSSSSSSSSS',
        songId: 'BBBBBBBBBBBB',
        startedAt: 5000,
        endedAt: 65_000,
        playedMs: 60_000,
        loops: [{ startBar: 'LLLLLLLLLLLL', endBar: 'MMMMMMMMMMMM', bestPercent: 80 }],
        tempoHistory: [{ atPlayedMs: 0, tempo: { mode: 'percent', value: 80 } }],
      },
      {
        id: 'TTTTTTTTTTTT',
        songId: 'AAAAAAAAAAAA',
        startedAt: 9000,
        endedAt: 19_000,
        playedMs: 10_000,
        loops: [],
        tempoHistory: [],
      },
    ],
  },
};

/** The database as a user who last ran with `schema` left it. */
async function writeAt(name: string, schema: readonly SchemaVersion[]) {
  const sample = SAMPLES[schema.length];
  if (!sample) throw new Error(`no sample rows for version ${String(schema.length)}`);
  const db = openLibraryDb(name, schema);
  open.push(db);
  await db.table('songs').bulkAdd(sample.songs);
  await db.table('settings').bulkAdd(sample.settings);
  if (sample.practiceSessions) await db.table('practiceSessions').bulkAdd(sample.practiceSessions);
  db.close();
  return sample;
}

describe('the library schema', () => {
  it('declares strictly increasing versions from 1', () => {
    expect(SCHEMA.map((entry) => entry.version)).toEqual(SCHEMA.map((_, index) => index + 1));
  });

  it('creates the songs and settings tables with the indexes the screen and imports use', async () => {
    const db = openLibraryDb(uniqueDbName());
    open.push(db);
    await db.open();
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'practiceSessions',
      'settings',
      'songs',
    ]);
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
      const sample = await writeAt(name, SCHEMA.slice(0, version));

      const db = openLibraryDb(name);
      open.push(db);
      const songs = await db.songs.toArray();
      const ids = (rows: unknown[]) =>
        rows.map((row) => String(Reflect.get(Object(row), 'id'))).sort();
      expect(ids(songs)).toEqual(ids(sample.songs));
      expect(ids(await db.practiceSessions.toArray())).toEqual(ids(sample.practiceSessions ?? []));
      for (const song of songs) expect(SongRowSchema.safeParse(song).success).toBe(true);
      expect((await db.settings.get('library.sort'))?.value).toBe('artist');
      const expected = new Set(SCHEMA.flatMap((entry) => Object.keys(entry.stores)));
      expect(new Set(db.tables.map((table) => table.name))).toEqual(expected);
    });
  });

  it('indexes practice sessions by song and start, so one song reads in order', async () => {
    const name = uniqueDbName();
    await writeAt(name, SCHEMA);
    const db = openLibraryDb(name);
    open.push(db);
    const rows = await db.practiceSessions
      .where('[songId+startedAt]')
      .between(['BBBBBBBBBBBB', 0], ['BBBBBBBBBBBB', Infinity])
      .toArray();
    expect(rows.map((row) => row.id)).toEqual(['SSSSSSSSSSSS']);
  });

  it('applies a later version on top of version 1 without touching rows', async () => {
    const name = uniqueDbName();
    await writeAt(name, SCHEMA);
    const future: SchemaVersion[] = [
      ...SCHEMA,
      { version: SCHEMA.length + 1, stores: { harnessProbe: 'id' } },
    ];
    const db = openLibraryDb(name, future);
    open.push(db);
    expect(await db.table('songs').count()).toBe(SAMPLES[SCHEMA.length]?.songs.length);
    expect(db.tables.map((table) => table.name)).toContain('harnessProbe');
  });
});
