import { describe, expect, it, vi } from 'vitest';

import { fakeDownload } from '@/test/services';

import { parseInstalledPack } from '../manifest';
import {
  folderOf,
  incomingOf,
  packContents,
  packPaths,
  syntheticManifest,
  testPlatform,
  zipFileOf,
  zipOf,
} from '../test/pack-fixtures';

import {
  downloadPackArchive,
  filesFromFolder,
  filesFromZip,
  InstallError,
  installPack,
  selectPackFiles,
  sweepWorkAreas,
  zipSourceOfPicked,
} from './install';

const ID = 'AbCdEfGh1234';
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

async function refusal(promise: Promise<unknown>): Promise<InstallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InstallError) return error;
    throw error;
  }
  throw new Error('expected the install to be refused');
}

describe('installPack: a custom pack', () => {
  it('installs a folder into data/sounds/<id>/files with a valid pack.json', async () => {
    const { platform, storage } = testPlatform();
    const folder = folderOf('My bass', packContents());
    const pack = await installPack({
      platform,
      id: ID,
      files: filesFromFolder(folder),
      name: folder.name,
      source: 'folder',
    });
    expect(storage.paths()).toEqual(
      expect.arrayContaining([
        `data/sounds/${ID}/pack.json`,
        `data/sounds/${ID}/files/default.sfz`,
        `data/sounds/${ID}/files/samples/a.wav`,
      ]),
    );
    const written = parseInstalledPack(decode(storage.bytes(`data/sounds/${ID}/pack.json`)));
    expect(written).toEqual(pack);
    expect(pack).toMatchObject({ id: ID, name: 'My bass', curated: false, source: 'folder' });
    expect(pack.instruments.map((instrument) => [instrument.key, instrument.entries])).toEqual([
      ['alt', { default: 'alt.sfz' }],
      ['default', { default: 'default.sfz' }],
    ]);
    expect(pack.files.map(([path]) => path)).toContain('samples/b.wav');
    expect(
      storage
        .paths()
        .filter((path) => path.startsWith('data/sounds/.staging/') && storage.bytes(path)),
    ).toEqual([]);
  });

  it('strips the one top-level folder and skips dot files, __MACOSX and other extensions', async () => {
    const { platform, storage } = testPlatform();
    const zip = await zipOf(packContents(), 'Pack/', [
      { name: 'Pack/.DS_Store', data: 'x' },
      { name: '__MACOSX/Pack/._default.sfz', data: 'x' },
      { name: 'Pack/cover.png', data: 'x' },
      { name: 'Pack/strings.nki', data: 'x' },
      { name: 'Pack/LICENSE', data: 'CC0' },
      { name: 'Pack/Notes/readme.txt', data: 'hi' },
    ]);
    const files = await filesFromZip(zipSourceOfPicked(zipFileOf('pack.zip', zip)));
    const pack = await installPack({ platform, id: ID, files, name: 'pack', source: 'zip' });
    expect(pack.files.map(([path]) => path).sort()).toEqual([
      'LICENSE',
      'Notes/readme.txt',
      'alt.sfz',
      'default.sfz',
      'samples/a.wav',
      'samples/b.wav',
    ]);
    expect(storage.bytes(`data/sounds/${ID}/files/LICENSE`)).toBeDefined();
  });

  it('adopts every .sfz that passes and names its instrument from the file', async () => {
    const { platform } = testPlatform();
    const contents = packContents({ 'bright-bass_v2.sfz': '<region> sample=samples/a.wav\n' });
    const pack = await installPack({
      platform,
      id: ID,
      files: incomingOf(contents),
      name: 'x',
      source: 'zip',
    });
    expect(pack.instruments.find((i) => i.entries.default === 'bright-bass_v2.sfz')).toMatchObject({
      key: 'bright-bass-v2',
      name: 'Bright bass v2',
    });
  });

  it.each([
    ['a sample file is missing', { 'samples/a.wav': null }],
    ['a sample has a bad header', { 'samples/a.wav': 'not a wav file at all, just text' }],
    [
      'an include is unresolved',
      { 'default.sfz': '#include "missing.inc"\n<region> sample=samples/a.wav\n' },
    ],
  ])('refuses and leaves nothing behind when %s', async (_label, changes) => {
    const { platform, storage } = testPlatform();
    // Only default.sfz is changed; alt.sfz still passes, so also drop it to leave nothing valid.
    const contents = packContents({ ...changes, 'alt.sfz': null });
    const error = await refusal(
      installPack({ platform, id: ID, files: incomingOf(contents), name: 'x', source: 'zip' }),
    );
    expect(error.problems.length).toBeGreaterThan(0);
    expect(packPaths(storage)).toEqual([]);
    expect(
      storage
        .paths()
        .filter((path) => path.startsWith('data/sounds/.staging/') && storage.bytes(path)),
    ).toEqual([]);
  });

  it('refuses a name the storage rules refuse, naming the file', async () => {
    const { platform, storage } = testPlatform();
    const contents = packContents({ 'samples/a:b.wav': 'x' });
    const error = await refusal(
      installPack({ platform, id: ID, files: incomingOf(contents), name: 'x', source: 'folder' }),
    );
    expect(error.message).toContain('samples/a:b.wav');
    expect(packPaths(storage)).toEqual([]);
  });

  it('accepts a sample named in another case and reads it through the index', async () => {
    const { platform } = testPlatform();
    const contents = packContents({
      'default.sfz': '<region> sample=Samples/A.WAV lokey=0 hikey=127 pitch_keycenter=60\n',
      'alt.sfz': null,
    });
    const pack = await installPack({
      platform,
      id: ID,
      files: incomingOf(contents),
      name: 'x',
      source: 'zip',
    });
    expect(pack.instruments).toHaveLength(1);
  });

  it('refuses a source with no pack files', async () => {
    const { platform } = testPlatform();
    const error = await refusal(
      installPack({
        platform,
        id: ID,
        files: incomingOf(new Map([['cover.png', new Uint8Array(3)]])),
        source: 'zip',
      }),
    );
    expect(error.message).toContain('No sound pack files');
  });

  it('cancels between files and cleans up', async () => {
    const { platform, storage } = testPlatform();
    const controller = new AbortController();
    const contents = packContents();
    const files = incomingOf(contents).map((file, index) => ({
      ...file,
      read: () => {
        if (index === 2) controller.abort();
        return file.read();
      },
    }));
    await expect(
      installPack({ platform, id: ID, files, name: 'x', source: 'zip', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(packPaths(storage)).toEqual([]);
    expect(storage.paths().filter((path) => storage.bytes(path))).toEqual([]);
  });

  it('reports progress through extracting, checking and committing', async () => {
    const { platform } = testPlatform();
    const phases: string[] = [];
    await installPack({
      platform,
      id: ID,
      files: incomingOf(packContents()),
      name: 'x',
      source: 'zip',
      onProgress: ({ phase }) => {
        if (phases.at(-1) !== phase) phases.push(phase);
      },
    });
    expect(phases).toEqual(['extracting', 'checking', 'committing']);
  });
});

describe('installPack: a curated pack', () => {
  it('refuses an archive that lacks an entry, by name', async () => {
    const { platform, storage } = testPlatform();
    const manifest = syntheticManifest();
    const error = await refusal(
      installPack({
        platform,
        id: manifest.id,
        manifest,
        files: incomingOf(packContents({ 'alt.sfz': null })),
        source: 'zip',
      }),
    );
    expect(error.message).toContain('Synthetic Pack');
    expect(error.message).toContain('alt.sfz');
    expect(packPaths(storage)).toEqual([]);
  });

  it('keeps the manifest, marks the pack curated and uses the root hint', async () => {
    const { platform } = testPlatform();
    const manifest = syntheticManifest({
      download: {
        url: 'https://example.com/p.zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 100,
        root: 'Inner',
      },
    });
    const contents = packContents();
    const files = [
      ...incomingOf(contents, 'Inner/'),
      ...incomingOf(new Map([['other.wav', new Uint8Array(2)]])),
    ];
    const pack = await installPack({ platform, id: manifest.id, manifest, files, source: 'zip' });
    expect(pack).toMatchObject({ curated: true, id: manifest.id, version: '1' });
    expect(pack.files.map(([path]) => path)).not.toContain('other.wav');
  });

  it('refuses an archive far larger than the manifest says', async () => {
    const { platform } = testPlatform();
    const manifest = syntheticManifest({ sizeBytes: 100 });
    const error = await refusal(
      installPack({
        platform,
        id: manifest.id,
        manifest,
        files: incomingOf(packContents()),
        source: 'zip',
      }),
    );
    expect(error.message).toContain('more data than expected');
  });
});

describe('installPack: replacing a pack', () => {
  const install = (
    platform: ReturnType<typeof testPlatform>['platform'],
    contents: Map<string, Uint8Array>,
    replace?: Parameters<typeof installPack>[0]['replace'],
  ) =>
    installPack({
      platform,
      id: ID,
      files: incomingOf(contents),
      name: 'x',
      source: 'zip',
      ...(replace && { replace }),
    });

  it('swaps the folder, releasing and leaving no trash', async () => {
    const { platform, storage } = testPlatform();
    await install(platform, packContents());
    const release = vi.fn(() => Promise.resolve());
    const reinstate = vi.fn(() => Promise.resolve());
    await install(platform, packContents({ 'samples/extra.wav': 'x', 'alt.sfz': null }), {
      release,
      reinstate,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(reinstate).not.toHaveBeenCalled();
    expect(storage.bytes(`data/sounds/${ID}/files/alt.sfz`)).toBeUndefined();
    expect(
      storage
        .paths()
        .filter((path) => path.startsWith('data/sounds/.trash/') && storage.bytes(path)),
    ).toEqual([]);
  });

  it('keeps the old pack when the new one fails its check', async () => {
    const { platform, storage } = testPlatform();
    await install(platform, packContents());
    const release = vi.fn(() => Promise.resolve());
    await refusal(
      install(platform, packContents({ 'samples/a.wav': null, 'alt.sfz': null }), {
        release,
        reinstate: vi.fn(),
      }),
    );
    expect(release).not.toHaveBeenCalled();
    expect(storage.bytes(`data/sounds/${ID}/files/alt.sfz`)).toBeDefined();
  });

  it('puts the old pack back and reinstates it when the final move fails', async () => {
    const { platform, storage } = testPlatform();
    await install(platform, packContents());
    const realMove = platform.move.bind(platform);
    const failing = {
      ...platform,
      move: vi.fn((from: string, to: string) =>
        from.startsWith('data/sounds/.staging/')
          ? Promise.reject(new Error('disk full'))
          : realMove(from, to),
      ),
    };
    const reinstate = vi.fn(() => Promise.resolve());
    await expect(
      install(failing, packContents(), { release: () => Promise.resolve(), reinstate }),
    ).rejects.toThrow('disk full');
    expect(reinstate).toHaveBeenCalledOnce();
    expect(storage.bytes(`data/sounds/${ID}/pack.json`)).toBeDefined();
    expect(storage.bytes(`data/sounds/${ID}/files/default.sfz`)).toBeDefined();
  });
});

describe('filesFromFolder', () => {
  it('refuses a truncated walk and one that skipped folders', () => {
    const folder = folderOf('Big', packContents());
    expect(() => filesFromFolder({ ...folder, truncated: true })).toThrow(InstallError);
    expect(() => filesFromFolder({ ...folder, skipped: 2 })).toThrow(/2 folders/);
  });
});

describe('selectPackFiles caps', () => {
  const file = (path: string, size = 1) => ({
    path,
    size,
    read: () => Promise.resolve(new Uint8Array(size)),
  });

  it('refuses more files than the limit', () => {
    const many = Array.from({ length: 10_001 }, (_, i) => file(`s/${String(i)}.wav`));
    expect(() => selectPackFiles(many)).toThrow(/10001 files/);
  });

  it('refuses an oversized text file and an oversized sample', () => {
    expect(() => selectPackFiles([file('a.sfz', 5 * 1024 * 1024)])).toThrow(/too large/);
    expect(() => selectPackFiles([file('a.wav', 129 * 1024 * 1024)])).toThrow(/too large/);
  });

  it('refuses a case-only collision and a traversal', () => {
    expect(() => selectPackFiles([file('A.wav'), file('a.WAV')])).toThrow(/differ only in case/);
    expect(() => selectPackFiles([file('../x.wav')])).toThrow(InstallError);
  });
});

describe('sweepWorkAreas', () => {
  it('removes staging, trash and downloads', async () => {
    const { platform, storage } = testPlatform();
    for (const dir of ['.staging/x', '.trash/y', '.downloads']) {
      await platform.writeFile(`data/sounds/${dir}/f.bin`, new Uint8Array(1));
    }
    await platform.writeFile(`data/sounds/${ID}/pack.json`, new Uint8Array(1));
    await sweepWorkAreas(platform);
    expect(storage.paths().filter((path) => storage.bytes(path))).toEqual([
      `data/sounds/${ID}/pack.json`,
    ]);
  });
});

describe('downloadPackArchive', () => {
  const zipManifest = async () => {
    const bytes = await zipOf(packContents());
    return {
      bytes,
      manifest: syntheticManifest({
        directDownload: true,
        download: {
          url: 'https://example.com/p.zip',
          sha256: 'b'.repeat(64),
          sizeBytes: bytes.length,
        },
      }),
    };
  };

  it('downloads through the platform with progress, and reads the archive by range', async () => {
    const { bytes, manifest } = await zipManifest();
    const t = testPlatform();
    const platform = {
      ...t.platform,
      download: fakeDownload(t.platform, { bytes, progress: [10, bytes.length] }),
    };
    const seen: number[] = [];
    const archive = await downloadPackArchive({
      platform,
      manifest,
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([10, bytes.length]);
    const files = await filesFromZip(archive.zip);
    const pack = await installPack({
      platform,
      id: manifest.id,
      manifest,
      files,
      source: 'download',
    });
    await archive.cleanup();
    expect(pack.source).toBe('download');
    expect(
      t.storage
        .paths()
        .filter((path) => path.startsWith('data/sounds/.downloads/') && t.storage.bytes(path)),
    ).toEqual([]);
  });

  it('surfaces a failed download and leaves no file', async () => {
    const { manifest } = await zipManifest();
    const t = testPlatform();
    const platform = {
      ...t.platform,
      download: fakeDownload(t.platform, {
        fail: new Error('The download does not match its SHA-256'),
      }),
    };
    await expect(downloadPackArchive({ platform, manifest })).rejects.toThrow('SHA-256');
    expect(t.storage.paths().filter((path) => t.storage.bytes(path))).toEqual([]);
  });

  it('is refused without a platform download', async () => {
    const { manifest } = await zipManifest();
    const { platform } = testPlatform();
    await expect(downloadPackArchive({ platform, manifest })).rejects.toBeInstanceOf(InstallError);
  });

  it('passes the manifest hash and a size cap with a margin', async () => {
    const { manifest } = await zipManifest();
    const t = testPlatform();
    const download = vi.fn(fakeDownload(t.platform, { bytes: new Uint8Array(1) }));
    await downloadPackArchive({ platform: { ...t.platform, download }, manifest });
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        sha256: 'b'.repeat(64),
        maxBytes: Math.ceil((manifest.download?.sizeBytes ?? 0) * 1.1),
        to: `data/sounds/.downloads/${manifest.id}.zip`,
      }),
    );
  });
});
