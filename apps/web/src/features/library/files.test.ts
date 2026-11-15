import { describe, expect, it } from 'vitest';

import { createMemoryStorage } from '@/test/memory-storage';

import { createLibraryFiles } from './files';
import { rowOf } from './test-support';

const bytes = (...values: number[]) => new Uint8Array(values);

function setup() {
  const storage = createMemoryStorage();
  return { storage, files: createLibraryFiles(storage.calls) };
}

describe('library files', () => {
  it('writes the native and the original under the row paths', async () => {
    const { storage, files } = setup();
    const row = rowOf({ originalName: 'a.gp5' });
    await files.write(row, bytes(1), bytes(2));
    expect(storage.bytes(row.nativePath)).toEqual(bytes(1));
    expect(storage.bytes(row.originalPath)).toEqual(bytes(2));
  });

  it('leaves no file behind when the second write fails', async () => {
    const { storage, files } = setup();
    const row = rowOf();
    const failing = createLibraryFiles({
      ...storage.calls,
      writeFile: (path, data) =>
        path === row.originalPath
          ? Promise.reject(new Error('disk full'))
          : storage.calls.writeFile(path, data),
    });
    await expect(failing.write(row, bytes(1), bytes(2))).rejects.toThrow('disk full');
    expect(storage.paths().filter((path) => path.includes(row.id))).toEqual([]);
    await expect(files.discard(row)).resolves.toBeUndefined();
  });

  it('moves the files and a copy of the row to the trash', async () => {
    const { storage, files } = setup();
    const row = rowOf();
    await files.write(row, bytes(1), bytes(2));
    await files.trash(row);
    expect(storage.bytes(row.nativePath)).toBeUndefined();
    expect(storage.bytes(row.originalPath)).toBeUndefined();
    const trashed = storage.paths().filter((path) => path.startsWith(`library/trash/${row.id}/`));
    expect(trashed).toEqual(
      expect.arrayContaining([
        `library/trash/${row.id}/${row.id}.reprise`,
        `library/trash/${row.id}/song.json`,
      ]),
    );
    const copy: unknown = JSON.parse(
      new TextDecoder().decode(storage.bytes(`library/trash/${row.id}/song.json`)),
    );
    expect(copy).toMatchObject({ id: row.id, title: row.title });
  });

  it('trashes a song whose files are already gone, and picks a free trash folder', async () => {
    const { storage, files } = setup();
    const row = rowOf();
    await files.trash(row);
    await files.trash(row);
    expect(storage.paths()).toEqual(
      expect.arrayContaining([
        `library/trash/${row.id}/song.json`,
        `library/trash/${row.id}-2/song.json`,
      ]),
    );
  });
});
