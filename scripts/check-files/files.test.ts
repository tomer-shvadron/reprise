import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discover, reportKey } from './files.ts';

let root: string;

const touch = (path: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), '');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-files-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discover', () => {
  it('walks folders, matches extensions in any case and sorts the result', () => {
    touch('local-tabs/b/song.GP5');
    touch('local-tabs/a.gpx');
    touch('local-tabs/c.gp');
    touch('local-tabs/README.md');
    touch('local-tabs/.DS_Store');
    touch('local-tabs/.hidden/x.gp3');
    const found = discover(['local-tabs'], root, root);
    expect(found.files.map((file) => file.absolute)).toEqual([
      join(root, 'local-tabs/a.gpx'),
      join(root, 'local-tabs/b/song.GP5'),
      join(root, 'local-tabs/c.gp'),
    ]);
    expect(found.files.map((file) => file.file)).toEqual(['local-1', 'local-2', 'local-3']);
    expect(found.skipped).toBe(3);
    expect(found.files.every((file) => file.source === 'local')).toBe(true);
  });

  it('marks files under fixtures/ as fixtures', () => {
    touch('fixtures/gp5/a.gp5');
    expect(discover(['fixtures'], root, root).files).toEqual([
      {
        file: 'fixtures/gp5/a.gp5',
        absolute: join(root, 'fixtures/gp5/a.gp5'),
        source: 'fixtures',
      },
    ]);
  });

  it('reports an empty folder and a missing path apart', () => {
    mkdirSync(join(root, 'local-tabs'));
    const found = discover(['local-tabs', 'nowhere'], root, root);
    expect(found).toMatchObject({ files: [], empty: ['local-tabs'], missing: ['nowhere'] });
  });

  it('names a folder given with a trailing slash without it', () => {
    mkdirSync(join(root, 'local-tabs'));
    expect(discover(['local-tabs/'], root, root).empty).toEqual(['local-tabs']);
  });

  it('treats a missing default folder as empty, not missing', () => {
    touch('fixtures/a.gp3');
    const found = discover([], root, root);
    expect(found).toMatchObject({ empty: ['local-tabs'], missing: [] });
    expect(found.files.map((file) => file.file)).toEqual(['fixtures/a.gp3']);
  });

  it('resolves paths against the directory pnpm was started from', () => {
    touch('local-tabs/sub/a.gp4');
    const found = discover(['a.gp4'], join(root, 'local-tabs/sub'), root);
    expect(found.files.map((file) => file.absolute)).toEqual([join(root, 'local-tabs/sub/a.gp4')]);
  });

  it('names a local file only by its number and the start of its hash', () => {
    writeFileSync(join(root, 'Secret Song.gp5'), 'bytes');
    const [file] = discover(['Secret Song.gp5'], root, root).files;
    expect(file).toMatchObject({ file: 'local-1', source: 'local', hash: '277089d91c0b' });
  });
});

describe('reportKey', () => {
  it('is repo-relative inside the root and absolute outside it', () => {
    expect(reportKey(join(root, 'local-tabs', 'a.gp5'), root)).toBe('local-tabs/a.gp5');
    expect(reportKey('/elsewhere/a.gp5', root)).toBe('/elsewhere/a.gp5');
  });
});
