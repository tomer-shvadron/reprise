import { describe, expect, it, vi } from 'vitest';

import { InstalledPackSchema } from './manifest';
import type { InstalledPack } from './manifest';
import { createPackFiles } from './pack-files';

const pack = (files: [string, number][]): InstalledPack =>
  InstalledPackSchema.parse({
    schema: 1,
    id: 'AbCdEfGh1234',
    name: 'P',
    family: 'bass',
    gmPrograms: [],
    format: 'sfz',
    version: '1',
    directDownload: false,
    instruments: [{ key: 'a', name: 'A', entries: { default: 'a.sfz' } }],
    curated: false,
    source: 'zip',
    installedAt: '2026-11-16T00:00:00.000Z',
    files,
  });

describe('createPackFiles', () => {
  const readFile = vi.fn((path: string) => Promise.resolve(new TextEncoder().encode(path)));
  const files = createPackFiles(
    { readFile },
    pack([
      ['samples/a.wav', 10],
      ['a.sfz', 5],
      ['__proto__', 1],
    ]),
  );

  it('reads an indexed path under the pack folder', async () => {
    expect(new TextDecoder().decode(await files.read('a.sfz'))).toBe(
      'data/sounds/AbCdEfGh1234/files/a.sfz',
    );
    expect(files.size?.('samples/a.wav')).toBe(10);
  });

  it('resolves a path in another case through the index', async () => {
    expect(new TextDecoder().decode(await files.read('Samples/A.WAV'))).toBe(
      'data/sounds/AbCdEfGh1234/files/samples/a.wav',
    );
    expect(files.size?.('SAMPLES/A.wav')).toBe(10);
  });

  it('never passes a path outside the index to the platform', async () => {
    readFile.mockClear();
    await expect(files.read('../../library/songs/x.reprise')).rejects.toThrow('No file');
    await expect(files.read('constructor')).rejects.toThrow('No file');
    expect(files.size?.('toString')).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('keeps a file named __proto__ as data', () => {
    expect(files.size?.('__proto__')).toBe(1);
  });
});
