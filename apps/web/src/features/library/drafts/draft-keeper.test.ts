import { read, write } from '@reprise/formats';
import { newId, setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage } from '@/test/memory-storage';
import { createTestServices, fakePlatform } from '@/test/services';

import { nativeOf } from '../import/parse-import';
import { DRAFT_DEBOUNCE_MS, DRAFT_MAX_WAIT_MS, startDraftKeeper } from './draft-keeper';
import { DraftSidecarSchema, draftNativePath, draftSidecarPath } from './draft-paths';

const SONG_A = newId();
const SONG_B = newId();
const SONG_Z = newId();
const song = () => score().title('Riff').track('guitar').build();

async function setup() {
  const storage = createMemoryStorage();
  const services = createTestServices({ platform: fakePlatform({ ...storage.calls }) });
  const bytes = (await write(song(), 'reprise')).bytes;
  const open = (songId?: string, modified = false) =>
    services.document.getState().openBytes('riff.reprise', bytes, {
      ...(songId && { songId }),
      ...(modified && { modified }),
    });
  const rename = (name: string) => {
    const { document } = services;
    document
      .getState()
      .apply(
        setTrackProperties({ trackId: document.getState().score?.tracks[0]?.id ?? '' }, { name }),
      );
  };
  const keeper = () =>
    startDraftKeeper({
      services,
      platform: services.platform,
      parser: { native: nativeOf, dispose: () => undefined },
      idle: (task) => {
        task();
      },
    });
  return { storage, services, open, rename, keeper };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the draft keeper', () => {
  it('writes nothing while the document is clean', async () => {
    const { storage, open, keeper } = await setup();
    await open(SONG_A);
    keeper();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.paths().filter((path) => path.includes('drafts'))).toEqual([]);
  });

  it('writes the bytes and a sidecar one second after the last edit', async () => {
    const { storage, services, open, rename, keeper } = await setup();
    await open(SONG_A);
    keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS - 100);
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS - 100);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    const bytes = storage.bytes(draftNativePath(SONG_A));
    expect(bytes).toBeDefined();
    const { score: saved } = await read(bytes ?? new Uint8Array(), 'reprise');
    expect(saved.tracks[0]?.name).toBe('Two');
    const sidecar = DraftSidecarSchema.parse(
      JSON.parse(new TextDecoder().decode(storage.bytes(draftSidecarPath(SONG_A)))),
    );
    expect(sidecar).toMatchObject({ key: SONG_A, songId: SONG_A, name: 'Riff' });
    expect(services.document.getState().dirty).toBe(true);
  });

  it('writes at least every ten seconds while edits keep coming', async () => {
    const { storage, rename, open, keeper } = await setup();
    await open(SONG_A);
    keeper();
    for (let at = 0; at < DRAFT_MAX_WAIT_MS; at += 500) {
      rename(`Edit ${String(at)}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(storage.bytes(draftNativePath(SONG_A))).toBeDefined();
  });

  it('keys a document with no song by its document id', async () => {
    const { storage, services, rename, keeper } = await setup();
    services.document.getState().newDocument(song());
    keeper();
    rename('New');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    const id = services.document.getState().id;
    expect(storage.bytes(draftNativePath(`doc-${id ?? ''}`))).toBeDefined();
  });

  it('removes the draft when the document is undone back to clean', async () => {
    const { storage, services, rename, open, keeper } = await setup();
    await open(SONG_A);
    keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeDefined();
    services.document.getState().undo();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
    expect(storage.bytes(draftSidecarPath(SONG_A))).toBeUndefined();
  });

  it('removes the draft when the document is replaced or closed', async () => {
    const { storage, services, rename, open, keeper } = await setup();
    await open(SONG_A);
    keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await open(SONG_B);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(storage.bytes(draftNativePath(SONG_B))).toBeDefined();
    services.document.getState().close();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_B))).toBeUndefined();
  });

  it('writes a pending draft at once on flush and drops a stale timer', async () => {
    const { storage, rename, open, keeper } = await setup();
    await open(SONG_A);
    const started = keeper();
    rename('One');
    await started.flush();
    expect(storage.bytes(draftNativePath(SONG_A))).toBeDefined();
  });

  it('writes a document that opens modified at once, as a recovered draft', async () => {
    const { storage, open, keeper } = await setup();
    keeper();
    await open(SONG_A, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeDefined();
  });

  it('removes the draft and writes no more after discard', async () => {
    const { storage, rename, open, keeper } = await setup();
    await open(SONG_A);
    const started = keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await started.discard();
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
  });

  it('removes the old key when a song id arrives while the edits stay unsaved', async () => {
    const { storage, services, rename, keeper } = await setup();
    services.document.getState().newDocument(song());
    keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    const docKey = `doc-${services.document.getState().id ?? ''}`;
    expect(storage.bytes(draftNativePath(docKey))).toBeDefined();
    services.document.getState().setSongId(SONG_Z);
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(storage.bytes(draftNativePath(SONG_Z))).toBeDefined();
    expect(storage.bytes(draftNativePath(docKey))).toBeUndefined();
  });
});
