import { PICKED_FOLDER_LIMITS } from '@/platform/platform';
import { describe, expect, it } from 'vitest';

import { snapshotPackDrop, walkDroppedFolder, zipFileOf } from './drop';
import { fakeDir, fakeFile } from './test/fake-entries';

// The fakes carry only what the walk reads; the DOM types are far wider.
const walk = (dir: ReturnType<typeof fakeDir>) =>
  walkDroppedFolder(dir as unknown as FileSystemDirectoryEntry);

describe('walkDroppedFolder', () => {
  it('reads every batch, skips dot entries and files the install does not copy', async () => {
    const tree = fakeDir(
      'Pack',
      [
        fakeFile('a.sfz'),
        fakeFile('.DS_Store'),
        fakeFile('cover.png'),
        fakeDir('.git', [fakeFile('x.sfz')]),
        fakeDir('samples', [fakeFile('a.wav'), fakeFile('B.FLAC')], { batch: 1 }),
        fakeFile('notes.txt'),
      ],
      { batch: 2 },
    );
    const folder = await walk(tree);
    expect(folder.name).toBe('Pack');
    expect(folder.files.map((file) => file.relativePath).sort()).toEqual([
      'a.sfz',
      'notes.txt',
      'samples/B.FLAC',
      'samples/a.wav',
    ]);
    expect(folder.truncated).toBe(false);
    expect(folder.skipped).toBe(0);
  });

  it('reads a file by range', async () => {
    const folder = await walk(fakeDir('P', [fakeFile('a.sfz', 'abcdef')]));
    const [file] = folder.files;
    expect(new TextDecoder().decode(await file?.read({ offset: 1, length: 3 }))).toBe('bcd');
    expect(new TextDecoder().decode(await file?.read())).toBe('abcdef');
  });

  it('counts only files the install copies toward the file cap', async () => {
    const others = Array.from({ length: PICKED_FOLDER_LIMITS.maxFiles + 5 }, (_, i) =>
      fakeFile(`art${String(i)}.png`),
    );
    const folder = await walk(fakeDir('P', [...others, fakeFile('a.sfz')]));
    expect(folder.truncated).toBe(false);
    expect(folder.files).toHaveLength(1);
  });

  it('truncates at the file cap', async () => {
    const many = Array.from({ length: PICKED_FOLDER_LIMITS.maxFiles + 1 }, (_, i) =>
      fakeFile(`s${String(i)}.wav`),
    );
    const folder = await walk(fakeDir('P', many, { batch: 5000 }));
    expect(folder.truncated).toBe(true);
    expect(folder.files).toHaveLength(PICKED_FOLDER_LIMITS.maxFiles);
  });

  it('truncates at the depth cap', async () => {
    let tree = fakeDir('leaf', [fakeFile('deep.wav')]);
    for (let i = 0; i < PICKED_FOLDER_LIMITS.maxDepth + 1; i += 1)
      tree = fakeDir(`d${String(i)}`, [tree]);
    const folder = await walk(tree);
    expect(folder.truncated).toBe(true);
    expect(folder.files).toHaveLength(0);
  });

  it('truncates at the entry cap', async () => {
    const many = Array.from({ length: PICKED_FOLDER_LIMITS.maxEntries + 1 }, (_, i) =>
      fakeFile(`n${String(i)}.png`),
    );
    const folder = await walk(fakeDir('P', many, { batch: 50_000 }));
    expect(folder.truncated).toBe(true);
  });

  it('counts a folder it cannot read as skipped, and does not pass it off as empty', async () => {
    const folder = await walk(fakeDir('P', [], { fail: true }));
    expect(folder.skipped).toBe(1);
    const nested = await walk(
      fakeDir('P', [fakeDir('locked', [], { fail: true }), fakeFile('a.sfz')]),
    );
    expect(nested.skipped).toBe(1);
    expect(nested.files).toHaveLength(1);
  });
});

describe('snapshotPackDrop', () => {
  const transfer = (items: unknown[], files: File[] = []) =>
    // Only `items` and `files` are read.
    ({ items, files }) as unknown as DataTransfer;

  it('tells a dropped folder from a dropped file through the items', () => {
    const dir = fakeDir('Pack', []);
    const zip = new File(['x'], 'pack.zip');
    const drop = snapshotPackDrop(
      transfer([
        { kind: 'file', webkitGetAsEntry: () => dir, getAsFile: () => null },
        { kind: 'file', webkitGetAsEntry: () => fakeFile('pack.zip'), getAsFile: () => zip },
        { kind: 'string', webkitGetAsEntry: () => null, getAsFile: () => null },
      ]),
    );
    expect(drop.directories).toHaveLength(1);
    expect(drop.files).toEqual([zip]);
  });

  it('falls back to the files list when there are no items', () => {
    const zip = new File(['x'], 'pack.zip');
    expect(snapshotPackDrop(transfer([], [zip])).files).toEqual([zip]);
  });
});

describe('zipFileOf', () => {
  it('serves ranges of the file', async () => {
    const zip = zipFileOf(new File(['0123456789'], 'p.zip'));
    expect(zip.size).toBe(10);
    expect(new TextDecoder().decode(await zip.read({ offset: 2, length: 4 }))).toBe('2345');
  });
});
