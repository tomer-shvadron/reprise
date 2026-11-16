import { read, write } from '@reprise/formats';
import { newId, setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Platform } from '@/platform/platform';
import { createMemoryStorage } from '@/test/memory-storage';
import { createTestServices, fakePlatform } from '@/test/services';

import { nativeOf } from '../import/parse-import';
import {
  DRAFT_DEBOUNCE_MS,
  DRAFT_MAX_WAIT_MS,
  startDraftKeeper,
  type DraftKeeperDeps,
} from './draft-keeper';
import { DraftSidecarSchema, draftNativePath, draftSidecarPath } from './draft-paths';

const SONG_A = newId();
const SONG_B = newId();
const SONG_Z = newId();
const song = () => score().title('Riff').track('guitar').build();

async function setup(wrap?: (real: Platform['writeFile']) => Platform['writeFile']) {
  const storage = createMemoryStorage();
  const real: Platform['writeFile'] = (path, bytes) => storage.calls.writeFile(path, bytes);
  const services = createTestServices({
    platform: fakePlatform({ ...storage.calls, ...(wrap && { writeFile: wrap(real) }) }),
  });
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
  const keeper = (options: Partial<DraftKeeperDeps> = {}) =>
    startDraftKeeper({
      services,
      platform: services.platform,
      createParser: () => ({ native: nativeOf, dispose: () => undefined }),
      idle: (task) => {
        task();
      },
      ...options,
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

  it('flush reports whether the open document’s draft is on disk', async () => {
    const { rename, open, keeper, services } = await setup();
    await open(SONG_A);
    const started = keeper();
    expect(await started.flush()).toBe(false);
    rename('One');
    expect(await started.flush()).toBe(true);
    services.document.getState().close();
    expect(await started.flush()).toBe(false);
  });
});

/** A platform whose writes of `.reprise` bytes wait until the test lets them through. */
async function gated() {
  let release = () => {
    // Nothing is held until `hold`.
  };
  let waiting = Promise.resolve();
  let reached = Promise.resolve();
  let reach = () => {
    // Replaced by `hold`.
  };
  const base = await setup((real) => async (path, bytes) => {
    if (path.endsWith('.reprise') && path.includes('drafts/')) {
      reach();
      await waiting;
    }
    return real(path, bytes);
  });
  const hold = () => {
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
  };
  return {
    ...base,
    hold,
    release: () => {
      release();
    },
    reached: () => reached,
  };
}

describe('a draft write that is already writing when it stops being wanted', () => {
  const drafts = (storage: { paths(): string[] }) =>
    storage.paths().filter((path) => path.includes('drafts/') && !path.endsWith('drafts'));

  it('is removed by a discard', async () => {
    const { storage, rename, open, keeper, hold, release, reached } = await gated();
    await open(SONG_A);
    const started = keeper();
    hold();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await reached();
    const discarded = started.discard();
    release();
    await discarded;
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts(storage)).toEqual([]);
  });

  it('is removed when the document is undone back to clean', async () => {
    const { storage, services, rename, open, keeper, hold, release, reached } = await gated();
    await open(SONG_A);
    keeper();
    hold();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await reached();
    services.document.getState().undo();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts(storage)).toEqual([]);
  });

  it('is removed when the document is closed or replaced', async () => {
    const { storage, services, rename, open, keeper, hold, release, reached } = await gated();
    await open(SONG_A);
    keeper();
    hold();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await reached();
    services.document.getState().close();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts(storage)).toEqual([]);
  });
});

describe('a save that ends with the document still modified', () => {
  it('is followed by a fresh draft', async () => {
    const { storage, services, rename, open, keeper } = await setup();
    await open(SONG_A);
    keeper();
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    const first = storage.bytes(draftSidecarPath(SONG_A));
    const sidecarOf = () =>
      DraftSidecarSchema.parse(
        JSON.parse(new TextDecoder().decode(storage.bytes(draftSidecarPath(SONG_A)))),
      );
    const before = sidecarOf().updatedAt;
    expect(first).toBeDefined();
    const mark = services.document.getState().beginSave();
    expect(mark).toBeDefined();
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    // The save ends having written only 'One': the document is still modified.
    vi.setSystemTime(Date.now() + 5000);
    if (!mark) throw new Error('no mark');
    services.document.getState().finishSave(mark, { cancelled: true });
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(sidecarOf().updatedAt).toBeGreaterThan(before);
    const { score: saved } = await read(
      storage.bytes(draftNativePath(SONG_A)) ?? new Uint8Array(),
      'reprise',
    );
    expect(saved.tracks[0]?.name).toBe('Two');
  });
});

describe('the parse worker', () => {
  it('is replaced once when it fails, and the draft is written', async () => {
    const { storage, rename, open, keeper } = await setup();
    await open(SONG_A);
    let made = 0;
    keeper({
      createParser: () => {
        made += 1;
        return made === 1
          ? { native: () => Promise.reject(new Error('worker died')), dispose: () => undefined }
          : { native: nativeOf, dispose: () => undefined };
      },
    });
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(made).toBe(2);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeDefined();
  });

  it('says autosave is off when it fails again, once', async () => {
    const { rename, open, keeper } = await setup();
    await open(SONG_A);
    const notify = vi.fn();
    keeper({
      notify,
      createParser: () => ({
        native: () => Promise.reject(new Error('no worker')),
        dispose: () => undefined,
      }),
    });
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Autosave is off: no worker');
  });

  it('does not stall a removal while it hangs', async () => {
    const { storage, services, rename, open, keeper } = await setup();
    await open(SONG_A);
    keeper({
      serializeTimeoutMs: 60_000,
      createParser: () => ({
        native: () => new Promise(() => undefined),
        dispose: () => undefined,
      }),
    });
    // A draft from before, which the hung write then has to be removed with.
    await services.platform.writeFile(draftNativePath(SONG_A), new Uint8Array([1]));
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    services.document.getState().undo();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_A))).toBeUndefined();
  });
});

describe('a draft that is waiting for the user’s answer', () => {
  it('is not overwritten: edits go under the document’s own key, which names no song', async () => {
    const { storage, services, rename, open, keeper } = await setup();
    await open(SONG_A);
    await services.platform.writeFile(draftNativePath(SONG_A), new Uint8Array([7]));
    keeper({ deferred: (key) => key === SONG_A });
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS * 3);
    expect(storage.bytes(draftNativePath(SONG_A))).toEqual(new Uint8Array([7]));
    const own = `doc-${services.document.getState().id ?? ''}`;
    const sidecar = DraftSidecarSchema.parse(
      JSON.parse(new TextDecoder().decode(storage.bytes(draftSidecarPath(own)))),
    );
    expect(sidecar.songId).toBeUndefined();
    // And undoing back to clean removes only what the keeper wrote.
    services.document.getState().undo();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.bytes(draftNativePath(SONG_A))).toEqual(new Uint8Array([7]));
    expect(storage.bytes(draftNativePath(own))).toBeUndefined();
  });
});

describe('what a draft’s time means', () => {
  it('is when its content was captured, not when it landed', async () => {
    const { storage, rename, open, keeper, hold, release, reached } = await gated();
    await open(SONG_A);
    keeper();
    hold();
    rename('One');
    const captured = Date.now() + DRAFT_DEBOUNCE_MS;
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    await reached();
    // A save begins, and the draft lands after it.
    await vi.advanceTimersByTimeAsync(5000);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const sidecar = DraftSidecarSchema.parse(
      JSON.parse(new TextDecoder().decode(storage.bytes(draftSidecarPath(SONG_A)))),
    );
    expect(sidecar.updatedAt).toBe(captured);
  });
});

describe('two serializations sharing a worker that fails', () => {
  it('replace it once, and say nothing while a healthy worker exists', async () => {
    const { storage, rename, open, keeper } = await setup();
    await open(SONG_A);
    const failures: ((error: Error) => void)[] = [];
    let made = 0;
    const notify = vi.fn();
    keeper({
      notify,
      createParser: () => {
        made += 1;
        if (made > 1) return { native: nativeOf, dispose: () => undefined };
        return {
          native: () =>
            new Promise((_, reject) => {
              failures.push(reject);
            }),
          dispose: () => {
            for (const fail of failures) fail(new Error('The parser was disposed'));
          },
        };
      },
    });
    rename('One');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    rename('Two');
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS);
    // Both calls are pending in the first worker; it dies.
    expect(failures).toHaveLength(2);
    for (const fail of failures) fail(new Error('worker died'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(made).toBe(2);
    expect(notify).not.toHaveBeenCalled();
    const { score: saved } = await read(
      storage.bytes(draftNativePath(SONG_A)) ?? new Uint8Array(),
      'reprise',
    );
    expect(saved.tracks[0]?.name).toBe('Two');
  });
});
