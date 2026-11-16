import { MAX_FILE_BYTES } from '@reprise/formats';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage } from '@/test/memory-storage';

import { createSongsRepository } from '../db/repository';
import { openLibraryDb, type RepriseDb } from '../db/schema';
import { createLibraryFiles } from '../files';
import { songBytes, sourceOf } from '../test/songs';
import { uniqueDbName } from '../test-support';
import { createImporter, type ImportProgress } from './importer';
import { createParser } from './parser';

const dbs: RepriseDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup(overrides: Partial<Parameters<typeof createImporter>[0]> = {}) {
  const db = openLibraryDb(uniqueDbName());
  dbs.push(db);
  const storage = createMemoryStorage();
  const repo = createSongsRepository(db);
  const added: string[] = [];
  const importer = createImporter({
    repo,
    files: createLibraryFiles(storage.calls),
    createParser,
    now: Date.now,
    onAdded: (rows) => added.push(...rows.map((row) => row.title)),
    ...overrides,
  });
  return { importer, repo, storage, added };
}

describe('the batch importer', () => {
  it('imports each song, counting progress up to the total', async () => {
    const { importer, repo, storage, added } = setup();
    const seen: number[] = [];
    importer.store.subscribe((state) => seen.push(state.done));
    await importer.add([
      sourceOf('a.reprise', await songBytes('A')),
      sourceOf('b.reprise', await songBytes('B')),
      sourceOf('c.reprise', await songBytes('C')),
    ]);
    const state = importer.store.getState();
    expect(state).toMatchObject({
      phase: 'done',
      total: 3,
      done: 3,
      imported: 3,
      current: undefined,
    });
    expect(seen.at(-1)).toBe(3);
    expect(added.sort()).toEqual(['A', 'B', 'C']);
    const rows = await repo.all();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(storage.bytes(row.nativePath)).toBeDefined();
      expect(storage.bytes(row.originalPath ?? '')).toBeDefined();
      expect(row.originalPath).toBe(`library/originals/${row.id}/${row.originalName}`);
    }
  });

  it('skips a song whose bytes are already in the library, in the batch or before it', async () => {
    const { importer, repo } = setup();
    const bytes = await songBytes('Same');
    await importer.add([sourceOf('one.reprise', bytes), sourceOf('two.reprise', bytes)]);
    expect(importer.store.getState()).toMatchObject({ imported: 1, duplicates: 1 });
    await importer.add([sourceOf('three.reprise', bytes)]);
    expect(importer.store.getState()).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await repo.all()).toHaveLength(1);
  });

  it('records a failure and goes on: unknown format, too large, unreadable', async () => {
    const { importer, repo } = setup();
    const unreadable = {
      name: 'broken.gp5',
      size: 10,
      read: () => Promise.reject(new Error('permission denied')),
    };
    await importer.add([
      sourceOf('notes.gp5', new TextEncoder().encode('not a score at all')),
      { name: 'huge.gp5', size: MAX_FILE_BYTES + 1, read: () => Promise.resolve(new Uint8Array()) },
      unreadable,
      sourceOf('good.reprise', await songBytes('Good')),
    ]);
    const { failed, imported, done } = importer.store.getState();
    expect(imported).toBe(1);
    expect(done).toBe(4);
    expect(failed.map((failure) => failure.name)).toEqual(['notes.gp5', 'huge.gp5', 'broken.gp5']);
    expect(failed[0]?.message).toMatch(/Not a Guitar Pro/);
    expect(failed[1]?.message).toMatch(/limit/);
    expect(failed[2]?.message).toMatch(/permission denied/);
    expect(await repo.all()).toHaveLength(1);
  });

  it('skips files that are not scores by their extension, without reading them', async () => {
    const { importer } = setup();
    const reads = { count: 0 };
    await importer.add([
      sourceOf('readme.txt', new Uint8Array([1]), reads),
      sourceOf('cover.png', new Uint8Array([1]), reads),
      sourceOf('a.reprise', await songBytes('A')),
    ]);
    expect(reads.count).toBe(0);
    expect(importer.store.getState()).toMatchObject({ total: 1, skipped: 2, imported: 1 });
  });

  it('leaves no row and no file when a write fails', async () => {
    const storage = createMemoryStorage();
    const files = createLibraryFiles({
      ...storage.calls,
      writeFile: (path, bytes) =>
        path.startsWith('library/originals/')
          ? Promise.reject(new Error('disk full'))
          : storage.calls.writeFile(path, bytes),
    });
    const { importer, repo } = setup({ files });
    await importer.add([sourceOf('a.reprise', await songBytes('A'))]);
    expect(importer.store.getState().failed).toEqual([{ name: 'a.reprise', message: 'disk full' }]);
    expect(await repo.all()).toEqual([]);
    expect(storage.paths().filter((path) => path.startsWith('library/songs/'))).toEqual([]);
  });

  it('stops after the file in flight when cancelled', async () => {
    const { importer, repo } = setup();
    const sources = await Promise.all(
      ['A', 'B', 'C', 'D'].map(async (title) =>
        sourceOf(`${title}.reprise`, await songBytes(title)),
      ),
    );
    const unsubscribe = importer.store.subscribe((state) => {
      if (state.done === 1) importer.cancel();
    });
    await importer.add(sources);
    unsubscribe();
    const state = importer.store.getState();
    expect(state).toMatchObject({ phase: 'done', cancelled: true, total: 4 });
    expect(state.imported).toBeLessThan(4);
    expect((await repo.all()).length).toBe(state.imported);
  });

  it('adds sources given while a batch runs to that batch', async () => {
    const { importer, repo } = setup();
    const first = importer.add([sourceOf('a.reprise', await songBytes('A'))]);
    const second = importer.add([sourceOf('b.reprise', await songBytes('B'))]);
    await Promise.all([first, second]);
    expect(importer.store.getState()).toMatchObject({ total: 2, imported: 2 });
    expect(await repo.all()).toHaveLength(2);
  });

  it('keeps the summary until dismissed, and carries the notes of a folder pick', async () => {
    const { importer } = setup();
    await importer.add([sourceOf('a.reprise', await songBytes('A'))], {
      truncated: true,
      unreadableFolders: 2,
    });
    const done: ImportProgress = importer.store.getState();
    expect(done).toMatchObject({ phase: 'done', truncated: true, unreadableFolders: 2 });
    importer.dismiss();
    expect(importer.store.getState().phase).toBe('idle');
  });

  it('finishes at once for a batch with nothing in it, and can start another', async () => {
    const { importer } = setup();
    await importer.add([sourceOf('readme.txt', new Uint8Array([1]))]);
    expect(importer.store.getState()).toMatchObject({ phase: 'done', total: 0, skipped: 1 });
    await importer.add([sourceOf('a.reprise', await songBytes('A'))]);
    expect(importer.store.getState()).toMatchObject({ phase: 'done', imported: 1 });
  });

  it('gives the next file a fresh parser after the worker dies', async () => {
    const real = createParser();
    let made = 0;
    const createParserOnce = () => {
      made += 1;
      return made === 1 ? { ...real, parse: () => Promise.reject(new Error('worker died')) } : real;
    };
    const { importer } = setup({ createParser: createParserOnce });
    await importer.add([
      sourceOf('a.reprise', await songBytes('A')),
      sourceOf('b.reprise', await songBytes('B')),
    ]);
    const state = importer.store.getState();
    expect(state.failed).toEqual([{ name: 'a.reprise', message: 'worker died' }]);
    expect(state.imported).toBe(1);
    vi.restoreAllMocks();
  });
});
