import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowOf, rowWithoutOriginal, uniqueDbName } from '../test-support';

import { createSongsRepository, type SongsRepository } from './repository';
import { openLibraryDb, type RepriseDb } from './schema';

let db: RepriseDb;
let repo: SongsRepository;

beforeEach(() => {
  db = openLibraryDb(uniqueDbName());
  repo = createSongsRepository(db);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('the songs repository', () => {
  it('adds, gets and removes a song', async () => {
    const row = rowOf();
    await repo.add(row);
    expect(await repo.get(row.id)).toEqual(row);
    await repo.remove(row.id);
    expect(await repo.get(row.id)).toBeUndefined();
  });

  it('updates the fields a save changes, and says when the song is gone', async () => {
    const row = rowOf();
    await repo.add(row);
    expect(await repo.update(row.id, { title: 'New', savedAt: 5, exportAcknowledged: ['a'] })).toBe(
      true,
    );
    expect(await repo.get(row.id)).toEqual({
      ...row,
      title: 'New',
      savedAt: 5,
      exportAcknowledged: ['a'],
    });
    expect(await repo.update('missing', { title: 'x' })).toBe(false);
  });

  it('reads a row with no original, as a song that began in Reprise has none', async () => {
    const bare = rowWithoutOriginal();
    await repo.add(bare);
    expect((await repo.get(bare.id))?.originalPath).toBeUndefined();
  });

  it('finds a song by the hash of its original and refuses a second one', async () => {
    const row = rowOf({ originalKey: 'abc' });
    await repo.add(row);
    expect((await repo.byKey('abc'))?.id).toBe(row.id);
    expect(await repo.byKey('nope')).toBeUndefined();
    await expect(repo.add(rowOf({ originalKey: 'abc' }))).rejects.toThrow();
  });

  it('lists recents by last opened, newest first, leaving out never-opened songs', async () => {
    const a = rowOf({ lastOpenedAt: 10 });
    const b = rowOf({ lastOpenedAt: 30 });
    const c = rowOf();
    const d = rowOf({ lastOpenedAt: 20 });
    for (const row of [a, b, c, d]) await repo.add(row);
    expect((await repo.recents(10)).map((row) => row.id)).toEqual([b.id, d.id, a.id]);
    expect(await repo.recents(2)).toHaveLength(2);
    await repo.touch(c.id, 99);
    expect((await repo.recents(1))[0]?.id).toBe(c.id);
  });

  it('keeps a track session on its song', async () => {
    const row = rowOf();
    await repo.add(row);
    const session = { version: 1 as const, view: { tracks: 'all' as const }, mixer: {} };
    await repo.setSession(row.id, session);
    expect((await repo.get(row.id))?.session).toEqual(session);
  });

  it('skips and logs a row that does not match its schema instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const good = rowOf();
    await repo.add(good);
    await db.table('songs').add({ id: 'not-an-id', title: 7 });
    expect((await repo.all()).map((row) => row.id)).toEqual([good.id]);
    expect(warn).toHaveBeenCalled();
    expect(await repo.get('not-an-id')).toBeUndefined();
  });

  it('stores settings by key', async () => {
    expect(await repo.getSetting('library.sort')).toBeUndefined();
    await repo.setSetting('library.sort', 'artist');
    await repo.setSetting('library.sort', 'title');
    expect(await repo.getSetting('library.sort')).toBe('title');
  });
});
