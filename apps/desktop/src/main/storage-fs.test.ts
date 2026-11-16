import {
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { cp, open, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listDirIn,
  mkdirIn,
  moveIn,
  readFileIn,
  removeIn,
  writeFileIn,
  type MoveOps,
  type WriteOps,
  type StorageRoots,
} from './storage-fs';
import { StoragePathError } from './storage-path';

let base: string;
let roots: StorageRoots;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'reprise-storage-'));
  roots = { library: join(base, 'library'), data: join(base, 'data') };
  mkdirSync(roots.library);
  mkdirSync(roots.data);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const put = (path: string, text = 'x') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

describe('storage file operations', () => {
  it('creates nested directories, and again without complaint', async () => {
    await mkdirIn(roots, 'library/songs/rock');
    await mkdirIn(roots, 'library/songs/rock');
    await mkdirIn(roots, 'data');

    await expect(listDirIn(roots, 'library/songs')).resolves.toEqual([
      { name: 'rock', kind: 'directory' },
    ]);
  });

  it('lists files and directories by name, and nothing for a missing directory', async () => {
    put(join(roots.library, 'b.gp'));
    put(join(roots.library, 'a.gp'));
    mkdirSync(join(roots.library, 'c'));

    await expect(listDirIn(roots, 'library')).resolves.toEqual([
      { name: 'a.gp', kind: 'file' },
      { name: 'b.gp', kind: 'file' },
      { name: 'c', kind: 'directory' },
    ]);
    await expect(listDirIn(roots, 'library/missing')).resolves.toEqual([]);
  });

  it('moves a file, creating the target parent, across the roots too', async () => {
    put(join(roots.library, 'a.gp'), 'one');

    await moveIn(roots, 'library/a.gp', 'library/songs/deep/a.gp');
    await moveIn(roots, 'library/songs/deep/a.gp', 'data/trash/a.gp');

    expect(readFileSync(join(roots.data, 'trash', 'a.gp'), 'utf8')).toBe('one');
    await expect(listDirIn(roots, 'library/songs/deep')).resolves.toEqual([]);
  });

  it('moves a directory tree', async () => {
    put(join(roots.library, 'album', 'disc', 'a.gp'), 'one');

    await moveIn(roots, 'library/album', 'data/trash/album');

    expect(readFileSync(join(roots.data, 'trash', 'album', 'disc', 'a.gp'), 'utf8')).toBe('one');
    await expect(listDirIn(roots, 'library')).resolves.toEqual([]);
  });

  it('refuses to move over an existing target, from a missing source, or into itself', async () => {
    put(join(roots.library, 'a.gp'));
    put(join(roots.library, 'b.gp'));
    mkdirSync(join(roots.library, 'dir'));

    await expect(moveIn(roots, 'library/a.gp', 'library/b.gp')).rejects.toThrow(/already exists/);
    await expect(moveIn(roots, 'library/nope.gp', 'library/c.gp')).rejects.toThrow(
      /Nothing to move/,
    );
    await expect(moveIn(roots, 'library/dir', 'library/dir/inner')).rejects.toThrow(/itself/);
    await expect(moveIn(roots, 'library', 'data/x')).rejects.toThrow(StoragePathError);
  });

  it('removes a file or a tree, and ignores what is not there', async () => {
    put(join(roots.library, 'album', 'a.gp'));

    await removeIn(roots, 'library/album');
    await removeIn(roots, 'library/album');

    await expect(listDirIn(roots, 'library')).resolves.toEqual([]);
    await expect(removeIn(roots, 'library')).rejects.toThrow(StoragePathError);
  });

  it.each([
    ['mkdir', (r: StorageRoots) => mkdirIn(r, '/tmp/x')],
    ['list', (r: StorageRoots) => listDirIn(r, 'library/../data')],
    ['move from', (r: StorageRoots) => moveIn(r, '../a', 'library/a')],
    ['move to', (r: StorageRoots) => moveIn(r, 'library/a', '/tmp/a')],
    ['remove', (r: StorageRoots) => removeIn(r, 'library/../../x')],
  ])('rejects an escaping path in %s', async (_name, run) => {
    await expect(run(roots)).rejects.toThrow(StoragePathError);
  });

  it('refuses to traverse a symlink, to a directory or a file, and leaves the target alone', async () => {
    const outside = join(base, 'outside');
    put(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(roots.library, 'link'));
    symlinkSync(join(outside, 'secret.txt'), join(roots.library, 'file-link'));

    await expect(listDirIn(roots, 'library/link')).rejects.toThrow(/symlink/);
    await expect(mkdirIn(roots, 'library/link/new')).rejects.toThrow(/symlink/);
    await expect(moveIn(roots, 'library/link/secret.txt', 'library/stolen.txt')).rejects.toThrow(
      /symlink/,
    );
    await expect(removeIn(roots, 'library/link')).rejects.toThrow(/symlink/);
    await expect(removeIn(roots, 'library/file-link')).rejects.toThrow(/symlink/);

    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    await expect(listDirIn(roots, 'library')).resolves.toEqual([]);
  });

  describe('across volumes (EXDEV)', () => {
    const exdev = Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    const crossVolume: MoveOps = {
      rename: () => Promise.reject(exdev),
      cp,
      rm,
    };

    it('copies, then removes the source', async () => {
      put(join(roots.library, 'album', 'a.gp'), 'one');

      await moveIn(roots, 'library/album', 'data/album', crossVolume);

      expect(readFileSync(join(roots.data, 'album', 'a.gp'), 'utf8')).toBe('one');
      expect(existsSync(join(roots.library, 'album'))).toBe(false);
    });

    it('removes a partial target when the copy fails, so a retry is not blocked', async () => {
      put(join(roots.library, 'a.gp'), 'one');
      const failingCopy: MoveOps = {
        ...crossVolume,
        cp: (_source, target) => {
          writeFileSync(String(target), 'partial');
          return Promise.reject(new Error('disk full'));
        },
      };

      await expect(moveIn(roots, 'library/a.gp', 'data/a.gp', failingCopy)).rejects.toThrow(
        /disk full/,
      );

      expect(existsSync(join(roots.data, 'a.gp'))).toBe(false);
      expect(readFileSync(join(roots.library, 'a.gp'), 'utf8')).toBe('one');
      await moveIn(roots, 'library/a.gp', 'data/a.gp', { rename, cp, rm });
      expect(readFileSync(join(roots.data, 'a.gp'), 'utf8')).toBe('one');
    });

    it('leaves a target that was not its own when the copy meets one that appeared', async () => {
      put(join(roots.library, 'a.gp'), 'one');
      const raced: MoveOps = {
        ...crossVolume,
        cp: (_source, target) => {
          writeFileSync(String(target), 'someone else');
          return Promise.reject(Object.assign(new Error('exists'), { code: 'ERR_FS_CP_EEXIST' }));
        },
      };

      await expect(moveIn(roots, 'library/a.gp', 'data/a.gp', raced)).rejects.toThrow(/exists/);

      expect(readFileSync(join(roots.data, 'a.gp'), 'utf8')).toBe('someone else');
    });

    it('passes force: false so a target created meanwhile is refused, never merged into', async () => {
      put(join(roots.library, 'a.gp'), 'one');
      let options: unknown;
      const spy: MoveOps = {
        ...crossVolume,
        cp: (source, target, opts) => {
          options = opts;
          return cp(source, target, opts);
        },
      };

      await moveIn(roots, 'library/a.gp', 'data/a.gp', spy);

      expect(options).toMatchObject({ force: false, errorOnExist: true });
    });

    it('rethrows any other rename failure without copying', async () => {
      put(join(roots.library, 'a.gp'), 'one');
      const denied: MoveOps = { ...crossVolume, rename: () => Promise.reject(new Error('EACCES')) };

      await expect(moveIn(roots, 'library/a.gp', 'data/a.gp', denied)).rejects.toThrow('EACCES');
      expect(existsSync(join(roots.data, 'a.gp'))).toBe(false);
    });
  });

  it('reads and writes a file under a root, making its folders, never through a symlink', async () => {
    await writeFileIn(roots, 'library/a/b/c.gp', new Uint8Array([1, 2]));
    await expect(readFileIn(roots, 'library/a/b/c.gp')).resolves.toEqual(Buffer.from([1, 2]));

    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(roots.library, 'link'));
    await expect(writeFileIn(roots, 'library/link/x.gp', new Uint8Array([1]))).rejects.toThrow(
      /symlink/,
    );
    await expect(readFileIn(roots, 'library')).rejects.toThrow(StoragePathError);
    expect(existsSync(join(outside, 'x.gp'))).toBe(false);
  });

  describe('atomic writes', () => {
    const real: WriteOps = { open, rename, rm };
    const names = (dir: string) => readdirSync(dir);

    it('replaces a file whole and leaves no temp file in its folder', async () => {
      put(join(roots.data, 'drafts', 'a.reprise'), 'old');

      await writeFileIn(roots, 'data/drafts/a.reprise', new Uint8Array([110, 101, 119]));

      expect(readFileSync(join(roots.data, 'drafts', 'a.reprise'), 'utf8')).toBe('new');
      expect(names(join(roots.data, 'drafts'))).toEqual(['a.reprise']);
    });

    it('flushes the temp file to disk before it renames it over the target', async () => {
      const order: string[] = [];
      const ops: WriteOps = {
        ...real,
        open: async (path, flags) => {
          const file = await open(path, flags);
          const sync = file.sync.bind(file);
          file.sync = async () => {
            order.push('sync');
            await sync();
          };
          return file;
        },
        rename: async (from, to) => {
          order.push('rename');
          await rename(from, to);
        },
      };

      await writeFileIn(roots, 'data/a.bin', new Uint8Array([1]), ops);

      expect(order).toEqual(['sync', 'rename']);
    });

    it('keeps the old file and removes the temp file when the rename fails', async () => {
      put(join(roots.data, 'a.bin'), 'old');
      const ops: WriteOps = {
        ...real,
        rename: () => Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' })),
      };

      await expect(writeFileIn(roots, 'data/a.bin', new Uint8Array([1]), ops)).rejects.toThrow(
        'EIO',
      );

      expect(readFileSync(join(roots.data, 'a.bin'), 'utf8')).toBe('old');
      expect(names(roots.data)).toEqual(['a.bin']);
    });

    it('removes the temp file when the write itself fails', async () => {
      const ops: WriteOps = {
        ...real,
        open: async (path, flags) => {
          const file = await open(path, flags);
          file.writeFile = () => Promise.reject(new Error('ENOSPC'));
          return file;
        },
      };

      await expect(writeFileIn(roots, 'data/a.bin', new Uint8Array([1]), ops)).rejects.toThrow(
        'ENOSPC',
      );

      expect(names(roots.data)).toEqual([]);
    });

    it('hides a temp file a crash left behind from listings', async () => {
      put(join(roots.data, 'a.bin'));
      put(join(roots.data, '.a.bin.0123456789ab.tmp'));

      await expect(listDirIn(roots, 'data')).resolves.toEqual([{ name: 'a.bin', kind: 'file' }]);
    });
  });
});
