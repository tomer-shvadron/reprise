import { describe, expect, it, vi } from 'vitest';

import { fakeDownload } from '@/test/services';

import { createSoundPackStore } from './pack-store';
import {
  folderOf,
  packContents,
  packPaths,
  syntheticManifest,
  testPlatform,
  zipFileOf,
  zipOf,
} from './test/pack-fixtures';

const fakeAudio = () => ({
  releasePack: vi.fn(() => Promise.resolve()),
  reinstatePack: vi.fn(() => Promise.resolve()),
});

async function storeWithZip(overrides = {}) {
  const t = testPlatform(overrides);
  const audio = fakeAudio();
  const store = createSoundPackStore({ platform: t.platform, audio: () => audio });
  const zip = zipFileOf('My Bass.zip', await zipOf(packContents(), 'Pack/'));
  return { ...t, audio, store, zip };
}

describe('the pack store: scan', () => {
  it('lists valid packs, reports damaged folders and skips dot folders', async () => {
    const { store, platform, zip } = await storeWithZip();
    await store.installZip(zip);
    const [pack] = store.getState().packs;
    if (!pack) throw new Error('not installed');
    const encoder = new TextEncoder();
    await platform.writeFile('data/sounds/Broken000001/pack.json', encoder.encode('{"nope":1}'));
    await platform.writeFile('data/sounds/NoManifest001/files/a.sfz', encoder.encode('x'));
    await platform.writeFile('data/sounds/.staging/leftover/files/a.wav', encoder.encode('x'));
    const wrongName = { ...pack, id: 'Other0000001' };
    await platform.writeFile(
      'data/sounds/WrongFolder01/pack.json',
      encoder.encode(JSON.stringify(wrongName)),
    );

    const fresh = createSoundPackStore({ platform });
    await fresh.scan();
    expect(fresh.getState().scanned).toBe(true);
    expect(fresh.getState().packs.map((p) => p.id)).toEqual([pack.id]);
    expect(
      fresh
        .getState()
        .damaged.map((d) => d.folder)
        .sort(),
    ).toEqual(['Broken000001', 'NoManifest001', 'WrongFolder01']);
    expect(fresh.get(pack.id)?.instruments.map((i) => i.key)).toEqual(['alt', 'default']);
    expect(await platform.listDir('data/sounds/.staging')).toEqual([]);
  });

  it('keeps the source object of an unchanged pack across scans', async () => {
    const { store } = await storeWithZip();
    await store.installZip(zipFileOf('a.zip', await zipOf(packContents())));
    const [first] = store.getState().installed;
    await store.scan();
    expect(store.getState().installed[0]).toBe(first);
  });

  it('serves the pack files through the platform', async () => {
    const { store, zip } = await storeWithZip();
    await store.installZip(zip);
    const source = store.getState().installed[0];
    const text = new TextDecoder().decode(await source?.files.read('default.sfz'));
    expect(text).toContain('<region>');
    expect(source?.files.size?.('samples/a.wav')).toBeGreaterThan(0);
  });
});

describe('the pack store: install', () => {
  it('installs a custom zip, names it from the file and notifies the directory once', async () => {
    const { store, zip, storage } = await storeWithZip();
    const listener = vi.fn();
    store.subscribe(listener);
    const phases: string[] = [];
    store.api.subscribe((state) => {
      const phase = state.job?.phase;
      if (phase && phases.at(-1) !== phase) phases.push(phase);
    });
    expect(await store.installZip(zip)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(phases).toEqual(['extracting', 'checking', 'committing']);
    const [pack] = store.getState().packs;
    expect(pack).toMatchObject({ name: 'My Bass', curated: false, source: 'zip' });
    expect(pack?.id).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(store.getState().job).toBeUndefined();
    expect(packPaths(storage).length).toBeGreaterThan(0);
  });

  it('installs a folder', async () => {
    const t = testPlatform();
    const store = createSoundPackStore({ platform: t.platform });
    expect(await store.installFolder(folderOf('Folder bass', packContents()))).toBe(true);
    expect(store.getState().packs[0]).toMatchObject({ name: 'Folder bass', source: 'folder' });
  });

  it('keeps the curated id on a curated drop', async () => {
    const t = testPlatform();
    const store = createSoundPackStore({ platform: t.platform });
    const manifest = syntheticManifest();
    expect(await store.installZip(zipFileOf('x.zip', await zipOf(packContents())), manifest)).toBe(
      true,
    );
    expect(store.get(manifest.id)?.name).toBe('Synthetic Pack');
    expect(store.getState().packs[0]).toMatchObject({ curated: true, name: 'Synthetic Pack' });
  });

  it('records a refusal as a problem with its details, and dismisses it', async () => {
    const t = testPlatform();
    const store = createSoundPackStore({ platform: t.platform });
    const manifest = syntheticManifest();
    const bad = zipFileOf('x.zip', await zipOf(packContents({ 'alt.sfz': null })));
    expect(await store.installZip(bad, manifest)).toBe(false);
    expect(store.getState().problems[manifest.id]?.message).toContain('alt.sfz');
    expect(store.getState().packs).toEqual([]);
    store.dismissProblem(manifest.id);
    expect(store.getState().problems).toEqual({});
  });

  it('refuses a second install while one runs', async () => {
    const { store, zip } = await storeWithZip();
    const slow = {
      ...zip,
      read: (range: { offset: number; length: number }) =>
        new Promise<Uint8Array>((resolve) =>
          setTimeout(() => void zip.read(range).then(resolve), 5),
        ),
    };
    const first = store.installZip(slow);
    const second = store.installZip(zip, syntheticManifest());
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(store.getState().problems[syntheticManifest().id]?.message).toContain('Another pack');
  });

  it('cancels a running install without a problem and cleans up', async () => {
    const { store, zip, storage } = await storeWithZip();
    const waiting = {
      ...zip,
      read: async (range: { offset: number; length: number }) => {
        store.cancel();
        return zip.read(range);
      },
    };
    expect(await store.installZip(waiting)).toBe(false);
    expect(store.getState().job).toBeUndefined();
    expect(store.getState().problems).toEqual({});
    expect(packPaths(storage)).toEqual([]);
  });

  it('downloads and installs a curated pack on a platform with download', async () => {
    const bytes = await zipOf(packContents());
    const manifest = syntheticManifest({
      directDownload: true,
      download: {
        url: 'https://example.com/p.zip',
        sha256: 'c'.repeat(64),
        sizeBytes: bytes.length,
      },
    });
    const t = testPlatform();
    const platform = {
      ...t.platform,
      download: fakeDownload(t.platform, { bytes, progress: [5, 50] }),
    };
    const store = createSoundPackStore({ platform });
    const done: number[] = [];
    store.api.subscribe((state) => {
      if (state.job?.phase === 'downloading') done.push(state.job.done);
    });
    expect(await store.installCurated(manifest)).toBe(true);
    expect(done).toEqual([5, 50]);
    expect(store.getState().packs[0]).toMatchObject({ source: 'download', curated: true });
  });

  it('surfaces a failed download (a hash mismatch) as a problem', async () => {
    const manifest = syntheticManifest({
      directDownload: true,
      download: { url: 'https://example.com/p.zip', sha256: 'c'.repeat(64), sizeBytes: 10 },
    });
    const t = testPlatform();
    const platform = {
      ...t.platform,
      download: fakeDownload(t.platform, { fail: new Error('SHA-256 mismatch') }),
    };
    const store = createSoundPackStore({ platform });
    expect(await store.installCurated(manifest)).toBe(false);
    expect(store.getState().problems[manifest.id]?.message).toContain('SHA-256 mismatch');
  });

  it('reinstalling releases the pack, swaps the files object and reinstates nothing', async () => {
    const t = testPlatform();
    const audio = fakeAudio();
    const store = createSoundPackStore({
      platform: t.platform,
      audio: () => audio,
      now: (() => {
        let n = 0;
        return () => new Date(Date.UTC(2026, 10, 16, 0, 0, n++));
      })(),
    });
    const manifest = syntheticManifest();
    const bytes = await zipOf(packContents());
    await store.installZip(zipFileOf('a.zip', bytes), manifest);
    const before = store.get(manifest.id);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.installZip(zipFileOf('a.zip', bytes), manifest);
    expect(audio.releasePack).toHaveBeenCalledWith(manifest.id);
    expect(audio.reinstatePack).not.toHaveBeenCalled();
    expect(store.get(manifest.id)?.files).not.toBe(before?.files);
    expect(listener).toHaveBeenCalled();
  });
});

describe('the pack store: stability', () => {
  it('does not tell the directory when a scan finds the same packs', async () => {
    const { store, zip } = await storeWithZip();
    await store.installZip(zip);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.scan();
    await store.scan();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a pack an install finished while a scan was reading', async () => {
    const t = testPlatform();
    const manifest = syntheticManifest();
    const zip = zipFileOf('a.zip', await zipOf(packContents()));
    const holder: { store?: ReturnType<typeof createSoundPackStore> } = {};
    let installed = false;
    const platform = {
      ...t.platform,
      listDir: async (path: string) => {
        // The scan lists the folders (none yet); the install then lands before the scan ends.
        const entries = await t.platform.listDir(path);
        if (path === 'data/sounds' && !installed) {
          installed = true;
          await holder.store?.installZip(zip, manifest);
        }
        return entries;
      },
    };
    const store = createSoundPackStore({ platform });
    holder.store = store;
    await store.scan();
    expect(store.get(manifest.id)).toBeDefined();
  });
});

describe('the pack store: remove and rename', () => {
  it('refuses a rename while that pack is installing', async () => {
    const { store, zip } = await storeWithZip();
    await store.installZip(zip);
    const [pack] = store.getState().packs;
    if (!pack) throw new Error('not installed');
    const slow = {
      ...zip,
      read: (range: { offset: number; length: number }) =>
        new Promise<Uint8Array>((resolve) => {
          setTimeout(() => void zip.read(range).then(resolve), 5);
        }),
    };
    const running = store.installZip(slow, syntheticManifest({ id: pack.id }));
    expect(await store.rename(pack.id, 'New name')).toBe(false);
    expect(await running).toBe(true);
    expect(store.get(pack.id)?.name).not.toBe('New name');
  });

  it('releases the pack from the engine before the folder is deleted', async () => {
    const t = testPlatform();
    const order: string[] = [];
    const audio = {
      releasePack: vi.fn(async () => {
        order.push('release-start');
        await Promise.resolve();
        order.push('release-done');
      }),
      reinstatePack: vi.fn(() => Promise.resolve()),
    };
    const realRemove = t.platform.remove.bind(t.platform);
    const platform = {
      ...t.platform,
      remove: vi.fn((path: string) => {
        order.push(`remove ${path}`);
        return realRemove(path);
      }),
    };
    const store = createSoundPackStore({ platform, audio: () => audio });
    const manifest = syntheticManifest();
    await store.installZip(zipFileOf('a.zip', await zipOf(packContents())), manifest);
    order.length = 0;
    expect(await store.remove(manifest.id)).toBe(true);
    expect(order).toEqual(['release-start', 'release-done', `remove data/sounds/${manifest.id}`]);
    expect(store.get(manifest.id)).toBeUndefined();
    expect(packPaths(t.storage)).toEqual([]);
    expect(audio.reinstatePack).not.toHaveBeenCalled();
  });

  it('clears what an update left in the trash, so the sweep cannot bring a removed pack back', async () => {
    const t = testPlatform();
    const store = createSoundPackStore({ platform: t.platform });
    const manifest = syntheticManifest();
    await store.installZip(zipFileOf('a.zip', await zipOf(packContents())), manifest);
    await t.platform.writeFile(
      `data/sounds/.trash/${manifest.id}-0a1b2c3d/pack.json`,
      new TextEncoder().encode('old'),
    );
    expect(await store.remove(manifest.id)).toBe(true);
    await store.scan();
    expect(store.getState().packs).toEqual([]);
    expect(packPaths(t.storage)).toEqual([]);
  });

  it('reinstates the pack and keeps it listed when the folder cannot be removed', async () => {
    const t = testPlatform();
    const audio = fakeAudio();
    const store = createSoundPackStore({
      platform: { ...t.platform, remove: vi.fn(() => Promise.reject(new Error('busy'))) },
      audio: () => audio,
    });
    const manifest = syntheticManifest();
    await store.installZip(zipFileOf('a.zip', await zipOf(packContents())), manifest);
    expect(await store.remove(manifest.id)).toBe(false);
    expect(audio.reinstatePack).toHaveBeenCalledWith(manifest.id);
    expect(store.get(manifest.id)).toBeDefined();
    expect(store.getState().problems[manifest.id]?.message).toContain('busy');
  });

  it('removes a damaged folder', async () => {
    const t = testPlatform();
    await t.platform.writeFile('data/sounds/Broken000001/files/a.sfz', new Uint8Array(1));
    const store = createSoundPackStore({ platform: t.platform });
    await store.scan();
    expect(store.getState().damaged).toHaveLength(1);
    expect(await store.removeDamaged('Broken000001')).toBe(true);
    expect(store.getState().damaged).toEqual([]);
    expect(packPaths(t.storage)).toEqual([]);
  });

  it('renames a pack in pack.json and keeps its files object and id', async () => {
    const t = testPlatform();
    const store = createSoundPackStore({ platform: t.platform });
    const manifest = syntheticManifest();
    await store.installZip(zipFileOf('a.zip', await zipOf(packContents())), manifest);
    const before = store.get(manifest.id);
    expect(await store.rename(manifest.id, '  Fretless  ')).toBe(true);
    expect(store.get(manifest.id)).toMatchObject({ id: manifest.id, name: 'Fretless' });
    expect(store.get(manifest.id)?.files).toBe(before?.files);
    const fresh = createSoundPackStore({ platform: t.platform });
    await fresh.scan();
    expect(fresh.get(manifest.id)?.name).toBe('Fretless');
    expect(await store.rename(manifest.id, '   ')).toBe(false);
  });
});
