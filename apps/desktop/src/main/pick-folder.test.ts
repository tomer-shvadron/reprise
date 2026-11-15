import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { walkFolder } from './pick-folder';

const filters = [{ name: 'Guitar Pro', extensions: ['gp', 'gp5'] }];
let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'reprise-pick-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const put = (...parts: string[]) => {
  const path = join(base, ...parts);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'abc');
};

describe('walkFolder', () => {
  it('lists matching files recursively with their relative paths and sizes', async () => {
    put('b.GP5');
    put('a.gp');
    put('notes.txt');
    put('sub', 'deep', 'c.gp');

    const folder = await walkFolder(base, filters);

    expect(folder.truncated).toBe(false);
    expect(folder.files.map(({ relativePath, name, size }) => [relativePath, name, size])).toEqual([
      ['a.gp', 'a.gp', 3],
      ['b.GP5', 'b.GP5', 3],
      ['sub/deep/c.gp', 'c.gp', 3],
    ]);
    expect(folder.files[2]?.path).toBe(join(base, 'sub', 'deep', 'c.gp'));
  });

  it('skips dot entries and symlinks', async () => {
    put('.hidden', 'a.gp');
    put('.dotfile.gp');
    put('real.gp');
    const outside = mkdtempSync(join(tmpdir(), 'reprise-outside-'));
    writeFileSync(join(outside, 'leak.gp'), 'x');
    symlinkSync(outside, join(base, 'link'));
    symlinkSync(join(outside, 'leak.gp'), join(base, 'leak.gp'));

    try {
      const folder = await walkFolder(base, filters);
      expect(folder.files.map((file) => file.relativePath)).toEqual(['real.gp']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports a walk stopped by the file cap or the depth cap', async () => {
    put('a.gp');
    put('b.gp');
    put('c.gp');
    put('d1', 'd2', 'deep.gp');
    put('z.gp');

    const capped = await walkFolder(base, filters, { maxFiles: 2, maxDepth: 16 });
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);

    const shallow = await walkFolder(base, filters, { maxFiles: 100, maxDepth: 1 });
    expect(shallow.files.map((file) => file.relativePath)).toEqual([
      'a.gp',
      'b.gp',
      'c.gp',
      'z.gp',
    ]);
    expect(shallow.truncated).toBe(true);

    const exact = await walkFolder(base, filters, { maxFiles: 5, maxDepth: 3 });
    expect(exact.truncated).toBe(false);
  });
});
