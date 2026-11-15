import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listDirIn, mkdirIn, moveIn, removeIn, type StorageRoots } from './storage-fs';
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
});
