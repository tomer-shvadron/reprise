import { describe, expect, it } from 'vitest';

import { createMemoryStorage } from './memory-storage';
import { fakePlatform } from './services';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('the in-memory storage double', () => {
  it('shares one store between the storage calls, readFile and writeFile', async () => {
    const storage = createMemoryStorage();
    const { calls } = storage;

    await calls.mkdir('library/songs');
    await calls.writeFile('library/songs/a.reprise', bytes(1, 2));

    expect(storage.paths()).toEqual(['library/songs', 'library/songs/a.reprise']);
    await expect(calls.listDir('library/songs')).resolves.toEqual([
      { name: 'a.reprise', kind: 'file' },
    ]);
    await expect(calls.readFile('library/songs/a.reprise')).resolves.toEqual(bytes(1, 2));
    await expect(calls.libraryDir()).resolves.toBe('/library');
  });

  it('moves files and trees, creating the parent, and refuses an existing target', async () => {
    const storage = createMemoryStorage();
    await storage.calls.writeFile('library/album/a.gp', bytes(1));
    await storage.calls.writeFile('library/b.gp', bytes(2));

    await storage.calls.move('library/album', 'data/trash/album');
    await expect(storage.calls.move('library/b.gp', 'data/trash')).rejects.toThrow(
      /already exists/,
    );
    await expect(storage.calls.move('library/b.gp', 'library/b.gp/x')).rejects.toThrow(/itself/);

    expect(storage.paths()).toEqual([
      'data/trash',
      'data/trash/album',
      'data/trash/album/a.gp',
      'library/b.gp',
    ]);
    expect(storage.bytes('data/trash/album/a.gp')).toEqual(bytes(1));
  });

  it('removes a tree, lists nothing for a missing directory, and refuses a root', async () => {
    const storage = createMemoryStorage();
    await storage.calls.writeFile('library/album/a.gp', bytes(1));

    await storage.calls.remove('library/album');

    expect(storage.paths()).toEqual([]);
    await expect(storage.calls.listDir('library/album')).resolves.toEqual([]);
    await expect(storage.calls.remove('library')).rejects.toThrow(/root/);
  });

  it.each([['/library/a'], ['library/../data'], ['elsewhere/a']])(
    'rejects the path %j',
    async (path) => {
      const { calls } = createMemoryStorage();

      await expect(calls.mkdir(path)).rejects.toThrow();
      await expect(calls.listDir(path)).rejects.toThrow();
      await expect(calls.remove(path)).rejects.toThrow();
    },
  );

  it('backs fakePlatform by default, with cancelling pickers', async () => {
    const platform = fakePlatform();

    await platform.mkdir('data/x');
    await expect(platform.listDir('data')).resolves.toEqual([{ name: 'x', kind: 'directory' }]);
    await expect(platform.openFiles([])).resolves.toEqual([]);
    await expect(platform.openFolder([])).resolves.toBeUndefined();
    expect(platform).not.toHaveProperty('setRecentSongs');
  });

  it('lets a test keep the store behind a fakePlatform', async () => {
    const storage = createMemoryStorage();
    const platform = fakePlatform({ ...storage.calls });

    await platform.writeFile('data/x.json', bytes(5));

    expect(storage.bytes('data/x.json')).toEqual(bytes(5));
  });

  it('uses the root-relative spelling for reads, writes and handles, creating parents on write', async () => {
    const storage = createMemoryStorage();
    const { calls } = storage;

    await calls.writeFile('library/songs/a.reprise', bytes(1));
    await calls.writeHandle('library/songs/a.reprise', bytes(2));

    expect(storage.paths()).toEqual(['library/songs', 'library/songs/a.reprise']);
    await expect(calls.readFile('library/songs/a.reprise')).resolves.toEqual(bytes(2));
    await expect(calls.readFile('/library/songs/a.reprise')).rejects.toThrow();
    await expect(calls.writeFile('/elsewhere/x', bytes(1))).rejects.toThrow();
    await expect(calls.writeFile('library', bytes(1))).rejects.toThrow();
    await expect(calls.writeHandle({}, bytes(1))).rejects.toThrow(/Not a file handle/);
  });

  it('rejects listDir on a file, and refuses Windows-hostile names', async () => {
    const { calls } = createMemoryStorage();
    await calls.writeFile('library/a.gp', bytes(1));

    await expect(calls.listDir('library/a.gp')).rejects.toThrow(/is a file/);
    await expect(calls.mkdir('library/CON')).rejects.toThrow();
    await expect(calls.mkdir('library/a.')).rejects.toThrow();
  });

  it('treats names as case-sensitive, so a case-only move succeeds as in OPFS', async () => {
    const storage = createMemoryStorage();
    await storage.calls.writeFile('library/a.gp', bytes(1));

    await storage.calls.move('library/a.gp', 'library/A.gp');

    expect(storage.paths()).toEqual(['library/A.gp']);
  });
});
