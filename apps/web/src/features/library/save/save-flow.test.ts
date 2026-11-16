import { read, write } from '@reprise/formats';
import { setTrackProperties, type Id } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Platform } from '@/platform/platform';
import { createMemoryStorage } from '@/test/memory-storage';
import type { AppServicesOptions } from '@/app/services';
import { createTestServices, fakePlatform } from '@/test/services';

import { createSongsRepository } from '../db/repository';
import type { SongRow } from '../db/rows';
import { openLibraryDb, type RepriseDb } from '../db/schema';
import { createLibraryFiles, type LibraryFiles } from '../files';
import { nativePathOf } from '../paths';
import { rowOf, uniqueDbName } from '../test-support';
import { createLibrarySaver } from './save-flow';

const dbs: RepriseDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

const song = (title = 'Riff') => score().title(title).artist('Artist').track('guitar').build();

function setup(
  options: {
    files?: (files: LibraryFiles) => LibraryFiles;
    read?: AppServicesOptions['read'];
  } = {},
) {
  const storage = createMemoryStorage();
  const writeHandle = vi.fn<Platform['writeHandle']>(() => Promise.resolve());
  const saveFile = vi.fn<() => Promise<string | undefined>>(() =>
    Promise.resolve('/m/Copy.reprise'),
  );
  const services = createTestServices({
    platform: fakePlatform({ ...storage.calls, writeHandle, saveFile }),
    ...(options.read && { read: options.read }),
  });
  const db = openLibraryDb(uniqueDbName());
  dbs.push(db);
  const repo = createSongsRepository(db);
  const files = (options.files ?? ((f) => f))(createLibraryFiles(services.platform));
  const notices: string[] = [];
  const settles = { count: 0 };
  const events = { added: [] as SongRow[], updated: [] as SongRow[], joined: [] as Id[] };
  const saver = createLibrarySaver({
    document: services.document,
    repo,
    files,
    now: () => 1000,
    onAdded: (row) => events.added.push(row),
    onUpdated: (row) => events.updated.push(row),
    onJoined: (id) => events.joined.push(id),
    settled: () => {
      settles.count += 1;
      return Promise.resolve();
    },
    notify: (message) => notices.push(message),
  });
  services.document.getState().setSaver(saver);
  const { document } = services;
  const edit = (name: string) => {
    document
      .getState()
      .apply(
        setTrackProperties({ trackId: document.getState().score?.tracks[0]?.id ?? '' }, { name }),
      );
  };
  /** Stores a library song and opens it as the library does. */
  const openSongRow = async (built = song()) => {
    const { bytes } = await write(built, 'reprise');
    const row = rowOf({
      sourceFormat: 'gp5',
      originalName: 'riff.gp5',
      originalPath: 'library/originals/x/riff.gp5',
    });
    await repo.add(row);
    await storage.calls.writeFile(row.nativePath, bytes);
    await storage.calls.writeFile(row.originalPath ?? '', new Uint8Array([9, 9, 9]));
    await document.getState().openBytes('riff.reprise', bytes, {
      handle: row.nativePath,
      songId: row.id,
    });
    return row;
  };
  return {
    settles,
    storage,
    services,
    repo,
    document,
    writeHandle,
    saveFile,
    notices,
    events,
    edit,
    openSongRow,
  };
}

describe('the library saver', () => {
  it('saves a library song to its native, never to the original, and updates its row', async () => {
    const { storage, document, repo, edit, openSongRow, events, writeHandle } = setup();
    const row = await openSongRow();
    edit('Lead');
    expect(document.getState().dirty).toBe(true);
    await document.getState().save();
    expect(document.getState().dirty).toBe(false);
    expect(storage.bytes('library/originals/x/riff.gp5')).toEqual(new Uint8Array([9, 9, 9]));
    const saved = (await read(storage.bytes(row.nativePath) ?? new Uint8Array())).score;
    expect(saved.tracks[0]?.name).toBe('Lead');
    expect(await repo.get(row.id)).toMatchObject({ savedAt: 1000, tracks: [{ name: 'Lead' }] });
    expect(events.updated).toHaveLength(1);
    expect(writeHandle).not.toHaveBeenCalled();
    expect(document.getState().file?.handle).toBe(row.nativePath);
    expect(document.getState().songId).toBe(row.id);
  });

  it('keeps the row title when the score has none', async () => {
    const { document, repo, openSongRow, edit } = setup();
    const row = await openSongRow(score().track('guitar').build());
    edit('Lead');
    await document.getState().save();
    expect((await repo.get(row.id))?.title).toBe(row.title);
  });

  it('writes a file opened without importing to its opened path', async () => {
    const { document, writeHandle, edit, notices, saveFile } = setup();
    const { bytes } = await write(song(), 'reprise');
    await document.getState().openBytes('mine.reprise', bytes, { handle: '/m/mine.reprise' });
    edit('Lead');
    await document.getState().save();
    expect(writeHandle.mock.calls.map(([handle]) => handle)).toEqual(['/m/mine.reprise']);
    expect(saveFile).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    expect(document.getState().dirty).toBe(false);
  });

  it('adds a new song to the library on its first Save, then saves it in place', async () => {
    const { document, repo, storage, events, edit, saveFile } = setup();
    document.getState().newDocument(song('Fresh'));
    edit('Lead');
    await document.getState().save();
    const { songId, file, dirty } = document.getState();
    expect([dirty, saveFile.mock.calls.length]).toEqual([false, 0]);
    expect(songId).toBeDefined();
    const row = await repo.get(songId ?? '');
    expect(row).toMatchObject({
      title: 'Fresh',
      sourceFormat: 'reprise',
      originalName: 'Fresh.reprise',
      nativePath: nativePathOf(songId ?? ''),
      savedAt: 1000,
    });
    expect(row?.originalPath).toBeUndefined();
    expect(file).toMatchObject({ name: 'Fresh.reprise', handle: row?.nativePath });
    expect(storage.bytes(row?.nativePath ?? '')).toBeDefined();
    expect(events.added.map((added) => added.id)).toEqual([songId]);
    expect(events.joined).toEqual([songId]);
    edit('Rhythm');
    await document.getState().save();
    expect(await repo.all()).toHaveLength(1);
    expect(events.updated).toHaveLength(1);
  });

  it('names an untitled new song Untitled', async () => {
    const { document, repo } = setup();
    document.getState().newDocument(score().track('guitar').build());
    await document.getState().save();
    expect((await repo.all())[0]).toMatchObject({
      title: 'Untitled',
      originalName: 'Untitled.reprise',
    });
  });

  it('waits for the import of a file just opened before choosing where to save', async () => {
    const { document, writeHandle, settles, edit } = setup();
    const { bytes } = await write(song(), 'reprise');
    await document.getState().openBytes('new.reprise', bytes, {
      handle: '/m/new.reprise',
      songId: 'imported-later',
    });
    edit('Lead');
    await document.getState().save();
    expect(settles.count).toBe(1);
    // No row after the wait: the file's own path, as when the import failed.
    expect(writeHandle.mock.calls.map(([handle]) => handle)).toEqual(['/m/new.reprise']);
  });

  it('ignores a second Save while the first is looking up its song', async () => {
    const writeNative = vi.fn<LibraryFiles['writeNative']>(() => Promise.resolve());
    const { document, openSongRow, edit } = setup({
      files: (files) => ({ ...files, writeNative }),
    });
    await openSongRow();
    edit('Lead');
    await Promise.all([document.getState().save(), document.getState().save()]);
    expect(writeNative).toHaveBeenCalledOnce();
  });

  it('sends a deleted song to Save As, with a notice, and does not follow its handle', async () => {
    const { document, writeHandle, saveFile, notices, openSongRow, edit } = setup();
    const row = await openSongRow();
    document.getState().setSongId(undefined);
    edit('Lead');
    await document.getState().save();
    expect(writeHandle.mock.calls.map(([handle]) => handle)).not.toContain(row.nativePath);
    expect(saveFile).toHaveBeenCalledOnce();
    expect(notices[0]).toMatch(/no longer in your library, so Save became Save As/);
    expect(document.getState().file?.handle).toBe('/m/Copy.reprise');
    expect(document.getState().songId).toBeUndefined();
  });

  it('sends a gp5 opened without importing to Save As and says why', async () => {
    const { document, saveFile, notices, edit } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [] }),
    });
    // The signature of a Guitar Pro 5 file is all `detect` looks at; the stub read supplies the score.
    const gp5 = new TextEncoder().encode('\u0018FICHIER GUITAR PRO v5.00');
    await document.getState().openBytes('chords.gp5', gp5, { handle: '/m/chords.gp5' });
    edit('Lead');
    await document.getState().save();
    expect(saveFile).toHaveBeenCalledOnce();
    expect(notices[0]).toMatch(/can't write Guitar Pro 5 files, so Save became Save As/);
    expect(document.getState().file?.name).toBe('Copy.reprise');
  });

  it('Save As writes a copy and detaches the document from its song', async () => {
    const { document, saveFile, repo, openSongRow, edit } = setup();
    const row = await openSongRow();
    edit('Lead');
    await document.getState().saveAs();
    expect(saveFile).toHaveBeenCalledOnce();
    expect(document.getState().songId).toBeUndefined();
    expect(document.getState().dirty).toBe(false);
    // The song keeps its last saved state.
    expect((await repo.get(row.id))?.savedAt).toBeUndefined();
  });

  it('a failed write keeps the document modified and reports the error', async () => {
    const { document, openSongRow, edit, repo } = setup({
      files: (files) => ({
        ...files,
        writeNative: () => Promise.reject(new Error('disk full')),
      }),
    });
    const row = await openSongRow();
    edit('Lead');
    await document.getState().save();
    expect(document.getState().dirty).toBe(true);
    expect(document.getState().saving).toBe(false);
    expect(document.getState().error).toMatchObject({ action: 'save', message: 'disk full' });
    expect((await repo.get(row.id))?.savedAt).toBeUndefined();
  });

  it('a failed first Save leaves no song and no file behind', async () => {
    const { document, repo, storage } = setup({
      files: (files) => ({
        ...files,
        write: () => Promise.reject(new Error('disk full')),
      }),
    });
    document.getState().newDocument(song());
    await document.getState().save();
    expect(await repo.all()).toEqual([]);
    expect(storage.paths().filter((path) => path.startsWith('library/songs/'))).toEqual([]);
    expect(document.getState().songId).toBeUndefined();
    expect(document.getState().error?.action).toBe('save');
  });
});
