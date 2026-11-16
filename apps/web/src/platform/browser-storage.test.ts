import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installMemoryOpfs,
  removeMemoryOpfs,
  type MemoryDirectoryHandle,
} from '@/test/memory-opfs';

import { createBrowserPlatform } from './browser-platform';
import { parseStoragePath } from './storage-path';

const text = (value: string) => Uint8Array.from(new TextEncoder().encode(value));

afterEach(() => {
  removeMemoryOpfs(window);
  vi.restoreAllMocks();
});

describe.each([
  ['with FileSystemHandle.move', true],
  ['without it (copy and delete)', false],
])('browser storage operations, %s', (_name, withMove) => {
  function setup(): {
    root: MemoryDirectoryHandle;
    platform: ReturnType<typeof createBrowserPlatform>;
  } {
    const root = installMemoryOpfs(window, { withMove });
    return { root, platform: createBrowserPlatform() };
  }

  it('makes nested directories, idempotently, where libraryDir() points', async () => {
    const { root, platform } = setup();

    await platform.mkdir('library/songs/rock');
    await platform.mkdir('library/songs/rock');
    await platform.mkdir('data');

    expect(root.tree()).toEqual(['data/', 'library/', 'library/songs/', 'library/songs/rock/']);
  });

  it('reads a range of a storage file, with whatever bytes exist past the end', async () => {
    const { root, platform } = setup();
    await root.put('data/sounds/pack.zip', new Uint8Array([0, 1, 2, 3, 4, 5]));

    await expect(
      platform.readFile('data/sounds/pack.zip', { offset: 2, length: 3 }),
    ).resolves.toEqual(new Uint8Array([2, 3, 4]));
    await expect(
      platform.readFile('data/sounds/pack.zip', { offset: 4, length: 100 }),
    ).resolves.toEqual(new Uint8Array([4, 5]));
    await expect(
      platform.readFile('data/sounds/pack.zip', { offset: 9, length: 2 }),
    ).resolves.toEqual(new Uint8Array());
    await expect(platform.readFile('data/sounds/pack.zip')).resolves.toHaveLength(6);
  });

  it.each([
    [{ offset: -1, length: 1 }],
    [{ offset: 0.5, length: 1 }],
    [{ offset: 0, length: -1 }],
    [{ offset: 0, length: 64 * 1024 * 1024 + 1 }],
  ])('refuses the read range %j', async (range) => {
    const { root, platform } = setup();
    await root.put('data/a.bin', new Uint8Array([1]));

    await expect(platform.readFile('data/a.bin', range)).rejects.toThrow(RangeError);
  });

  it('has no download', () => {
    expect('download' in setup().platform).toBe(false);
  });

  it('lists a directory by name, and nothing for one that does not exist', async () => {
    const { root, platform } = setup();
    await root.put('library/b.gp', text('b'));
    await root.put('library/a.gp', text('a'));
    await root.put('library/sub/c.gp', text('c'));

    await expect(platform.listDir('library')).resolves.toEqual([
      { name: 'a.gp', kind: 'file' },
      { name: 'b.gp', kind: 'file' },
      { name: 'sub', kind: 'directory' },
    ]);
    await expect(platform.listDir('library/missing')).resolves.toEqual([]);
    await expect(platform.listDir('data')).resolves.toEqual([]);
  });

  it('moves a file and a directory tree, making the target parent', async () => {
    const { root, platform } = setup();
    await root.put('library/a.gp', text('one'));
    await root.put('library/album/disc/b.gp', text('two'));

    await platform.move('library/a.gp', 'library/songs/a.gp');
    await platform.move('library/album', 'data/trash/album');

    expect(root.tree()).toEqual([
      'data/',
      'data/trash/',
      'data/trash/album/',
      'data/trash/album/disc/',
      'data/trash/album/disc/b.gp',
      'library/',
      'library/songs/',
      'library/songs/a.gp',
    ]);
    const moved = await (
      await (await root.getDirectoryHandle('library')).getDirectoryHandle('songs')
    ).getFileHandle('a.gp');
    expect(new TextDecoder().decode(moved.bytes)).toBe('one');
  });

  it('refuses an existing target, a missing source, a move into itself and a root', async () => {
    const { root, platform } = setup();
    await root.put('library/a.gp', text('a'));
    await root.put('library/b.gp', text('b'));
    await root.put('library/dir/x.gp', text('x'));

    await expect(platform.move('library/a.gp', 'library/b.gp')).rejects.toThrow(/already exists/);
    await expect(platform.move('library/none', 'library/c')).rejects.toThrow(/Nothing to move/);
    await expect(platform.move('library/dir', 'library/dir/inner')).rejects.toThrow(/itself/);
    await expect(platform.move('library', 'data/x')).rejects.toThrow(/root/);
    await expect(platform.remove('library')).rejects.toThrow(/root/);
    expect(root.tree()).toContain('library/a.gp');
  });

  it('removes a file or a tree, and ignores what is not there', async () => {
    const { root, platform } = setup();
    await root.put('library/album/disc/a.gp', text('a'));
    await root.put('library/keep.gp', text('k'));

    await platform.remove('library/album');
    await platform.remove('library/album');
    await platform.remove('data/never/existed');

    expect(root.tree()).toEqual(['library/', 'library/keep.gp']);
  });
});

describe('browser storage paths', () => {
  it.each([
    ['/library/a'],
    ['library/../data/a'],
    ['library/..'],
    ['C:/x'],
    ['library\\a'],
    ['library//a'],
    ['library/a/'],
    ['other/a'],
    [''],
    ['library/songs.'],
    ['library/a '],
    ['library/...'],
    ['library/CON'],
    ['data/nul.txt'],
    ['library/lpt1.gp'],
    ['library/CONIN$'],
    ['library/conout$.txt'],
    ['library/COM\u00b9'],
    ['library/lpt\u00b2.gp'],
    ['library/COM\u00b3.tar.gz'],
    ['library/a<b'],
    ['library/a|b'],
    ['library/a?b'],
    ['library/a*b'],
    ['library/a:b'],
    ['library/a\tb'],
    ['library/a\0b'],
    [`library/${'x'.repeat(256)}`],
    ['Library/a'],
    ['library/.'],
  ])('refuses %j in every storage call without touching storage', async (path) => {
    const root = installMemoryOpfs(window);
    const platform = createBrowserPlatform();

    await expect(platform.mkdir(path)).rejects.toThrow();
    await expect(platform.listDir(path)).rejects.toThrow();
    await expect(platform.remove(path)).rejects.toThrow();
    await expect(platform.move(path, 'library/x')).rejects.toThrow();
    await expect(platform.move('library/x', path)).rejects.toThrow();
    expect(root.tree()).toEqual([]);
  });

  it('parses a path into its root and segments', () => {
    expect(parseStoragePath('data/trash/a.gp')).toEqual({
      root: 'data',
      segments: ['trash', 'a.gp'],
    });
    expect(parseStoragePath('library')).toEqual({ root: 'library', segments: [] });
  });
});

describe('storage persistence', () => {
  it('asks for it once, on first use of storage, however many calls follow', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    installMemoryOpfs(window, { persist });
    const platform = createBrowserPlatform();

    await platform.mkdir('library/a');
    await platform.listDir('library');
    await platform.libraryDir();
    await createBrowserPlatform().remove('library/a');

    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not fail when persist is refused or missing', async () => {
    installMemoryOpfs(window, { persist: () => Promise.reject(new Error('denied')) });
    await expect(createBrowserPlatform().mkdir('library/a')).resolves.toBeUndefined();
    removeMemoryOpfs(window);
    installMemoryOpfs(window);
    await expect(createBrowserPlatform().mkdir('library/a')).resolves.toBeUndefined();
  });
});

describe('browser file paths', () => {
  it('reads, writes and writes through a handle by the root-relative path, making folders', async () => {
    const root = installMemoryOpfs(window);
    const platform = createBrowserPlatform();

    await platform.writeFile('library/songs/deep/a.reprise', text('one'));
    await platform.writeHandle('library/songs/deep/a.reprise', text('two'));

    expect(root.tree()).toEqual([
      'library/',
      'library/songs/',
      'library/songs/deep/',
      'library/songs/deep/a.reprise',
    ]);
    await expect(platform.readFile('library/songs/deep/a.reprise')).resolves.toEqual(text('two'));
    // the absolute spelling libraryDir() implies no longer reaches the roots
    await expect(platform.readFile('/library/songs/deep/a.reprise')).rejects.toThrow(
      /Not a storage path/,
    );
    await expect(platform.writeFile('/library/x.gp', text('x'))).rejects.toThrow(
      /Not a storage path/,
    );
  });

  it('refuses a root as a file and an escaping path', async () => {
    installMemoryOpfs(window);
    const platform = createBrowserPlatform();

    await expect(platform.writeFile('library', text('x'))).rejects.toThrow(/root/);
    await expect(platform.readFile('library/../data/x')).rejects.toThrow();
  });
});

describe('move when FileSystemHandle.move is unreliable', () => {
  it('falls back to a copy when the engine says move is unsupported', async () => {
    const root = installMemoryOpfs(window, { withMove: 'unsupported' });
    await root.put('library/a.gp', text('one'));

    await createBrowserPlatform().move('library/a.gp', 'data/a.gp');

    expect(root.tree()).toEqual(['data/', 'data/a.gp', 'library/']);
  });

  it('does not copy over any other move failure', async () => {
    const root = installMemoryOpfs(window, { withMove: 'broken' });
    await root.put('library/a.gp', text('one'));

    await expect(createBrowserPlatform().move('library/a.gp', 'data/a.gp')).rejects.toThrow(
      'move failed',
    );
    expect(root.tree()).toEqual(['data/', 'library/', 'library/a.gp']);
  });
});
