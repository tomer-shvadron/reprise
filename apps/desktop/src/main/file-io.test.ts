import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPath, writePath } from './file-io';
import { PathAccess } from './path-access';
import type { StorageRoots } from './storage-fs';

let base: string;
let roots: StorageRoots;
let access: PathAccess;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'reprise-io-'));
  roots = { library: join(base, 'library'), data: join(base, 'data') };
  mkdirSync(roots.library);
  mkdirSync(roots.data);
  access = new PathAccess();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const bytes = (...values: number[]) => new Uint8Array(values);

describe('file:read and file:write paths', () => {
  it('reads a picked file but refuses to write over it', async () => {
    const picked = join(base, 'tabs-a.gp');
    writeFileSync(picked, 'original');
    access.grantRead(picked);

    expect(Array.from(await readPath(picked, access, roots))).toEqual(
      Array.from(new Uint8Array(Buffer.from('original'))),
    );
    await expect(writePath(picked, bytes(1), access, roots)).rejects.toThrow(/Write access/);
    expect(readFileSync(picked, 'utf8')).toBe('original');
  });

  it('writes a file the user opened or saved in a dialog', async () => {
    const saved = join(base, 'saved.gp');
    writeFileSync(saved, 'x');
    access.grant(saved);

    await writePath(saved, bytes(7), access, roots);

    expect(readFileSync(saved)).toEqual(Buffer.from([7]));
  });

  it('refuses a file nothing granted, for reading and writing', async () => {
    const other = join(base, 'other.gp');
    writeFileSync(other, 'x');

    await expect(readPath(other, access, roots)).rejects.toThrow(/Read access/);
    await expect(writePath(other, bytes(1), access, roots)).rejects.toThrow(/Write access/);
  });

  it('writes and reads a root-relative path, making the folders above it', async () => {
    await writePath('library/songs/deep/a.reprise', bytes(1, 2), access, roots);

    expect(readFileSync(join(roots.library, 'songs', 'deep', 'a.reprise'))).toEqual(
      Buffer.from([1, 2]),
    );
    expect(Array.from(await readPath('library/songs/deep/a.reprise', access, roots))).toEqual(
      Array.from(bytes(1, 2)),
    );
  });

  it('refuses root-relative escapes, roots, and Windows-hostile names', async () => {
    for (const path of ['library/../data/x', 'library', 'data/CON', 'library/a.']) {
      await expect(writePath(path, bytes(1), access, roots)).rejects.toThrow();
      await expect(readPath(path, access, roots)).rejects.toThrow();
    }
  });

  it('refuses an absolute path under a root: only the root-relative route reaches the roots', async () => {
    const inside = join(roots.library, 'a.gp');
    writeFileSync(inside, 'x');

    await expect(writePath(inside, bytes(3), access, roots)).rejects.toThrow(/Write access/);
    await expect(readPath(inside, access, roots)).rejects.toThrow(/Read access/);
  });
});
