import { vi, type Mock } from 'vitest';

import type { AudioService } from '@/app/audio/audio-service';
import { createAppServices, type AppServices, type AppServicesOptions } from '@/app/services';
import type { Platform } from '@/platform/platform';
import { createUiStore } from '@/state/ui';
import { parseStoragePath } from '@/platform/storage-path';
import { createMemoryStorage } from '@/test/memory-storage';

const notUsed = () => Promise.reject(new Error('not used'));

/** What a scripted `fakeDownload` does; a test picks the ending. */
export interface FakeDownloadScript {
  /** The bytes written to `to` on success. */
  bytes?: Uint8Array;
  /** The `loaded` values reported, in order, with `total` as the byte count of `bytes`. */
  progress?: readonly number[];
  /** Rejects with this after the progress steps and writes nothing, like a mismatch or a network error. */
  fail?: Error;
}

/**
 * A desktop `Platform.download` for tests: reports the scripted progress, then either fails or
 * writes the bytes through `storage.writeFile`, with the real contract's checks: an `https:` URL,
 * `to` a storage path under `data/sounds/`, and the bytes within `maxBytes`. An aborted `signal` rejects with an `AbortError` and
 * writes nothing. The browser has no `download`, so `fakePlatform` leaves it out by default.
 */
export function fakeDownload(
  storage: Pick<Platform, 'writeFile'>,
  script: FakeDownloadScript = {},
): NonNullable<Platform['download']> {
  return async ({ url, to, maxBytes, onProgress, signal }) => {
    if (!url.startsWith('https://')) throw new Error('Only https: URLs are downloaded');
    parseStoragePath(to);
    if (!to.startsWith('data/sounds/')) throw new Error('A download goes under data/sounds/');
    const bytes = script.bytes ?? new Uint8Array();
    if (bytes.byteLength > maxBytes) throw new Error('The download is over maxBytes');
    const abort = () => new DOMException('The download was cancelled', 'AbortError');
    if (signal?.aborted) throw abort();
    for (const loaded of script.progress ?? []) {
      onProgress?.(loaded, bytes.byteLength);
      await Promise.resolve();
      if (signal?.aborted) throw abort();
    }
    if (script.fail) throw script.fail;
    await storage.writeFile(to, bytes);
    return { size: bytes.byteLength };
  };
}

/**
 * A platform for tests. The pickers cancel and the file operations (`mkdir`, `listDir`, `move`,
 * `remove`, `readFile` with or without a range, `writeFile`, `writeHandle` with a path, `libraryDir`, `dataDir`) run over an in-memory store with the
 * real contract's path rules; every other call rejects unless the test overrides it. Pass
 * `createMemoryStorage().calls` in the overrides to keep a handle on the store.
 */
export function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    openFile: vi.fn(() => Promise.resolve(undefined)),
    saveFile: notUsed,
    openFiles: vi.fn(() => Promise.resolve([])),
    openFolder: vi.fn(() => Promise.resolve(undefined)),
    ...createMemoryStorage().calls,
    print: notUsed,
    microphone: notUsed,
    ...overrides,
  };
}

export type FakeAudioService = { [K in keyof AudioService]: Mock<AudioService[K]> };

/** An audio service that records calls and never touches Web Audio. */
export function fakeAudioService(): FakeAudioService {
  return {
    unlock: vi.fn(),
    setDocument: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    outputLatency: vi.fn(() => 0),
    setTempo: vi.fn(),
    setLoop: vi.fn(),
    setCountIn: vi.fn(),
    setMetronome: vi.fn(),
    startClick: vi.fn(),
    updateClick: vi.fn(),
    stopClick: vi.fn(),
    setMasterVolume: vi.fn(),
    setGmTierBypass: vi.fn(),
    setStageBypass: vi.fn(),
    setTrack: vi.fn(),
    previewTrack: vi.fn(),
    previewNote: vi.fn(),
    releasePack: vi.fn(() => Promise.resolve()),
    reinstatePack: vi.fn(() => Promise.resolve()),
    retry: vi.fn(),
    settled: vi.fn(() => Promise.resolve()),
    debug: vi.fn(() => {
      throw new Error('the fake audio service has no engine');
    }),
    dispose: vi.fn(),
  };
}

/** A `Storage` held in memory, so tests never share `localStorage`. */
export function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** Real stores over a fake platform and a fake audio service, for jsdom tests. */
export function createTestServices(
  options: Partial<AppServicesOptions> = {},
): AppServices & { fakeAudio: FakeAudioService } {
  let fakeAudio: FakeAudioService | undefined;
  const storage = memoryStorage();
  const services = createAppServices({
    platform: options.platform ?? fakePlatform(),
    ui: options.ui ?? createUiStore('dark'),
    audio:
      options.audio ??
      (() => {
        fakeAudio = fakeAudioService();
        return fakeAudio;
      }),
    ...(options.read && { read: options.read }),
    ...(options.write && { write: options.write }),
    storage: options.storage ?? (() => storage),
  });
  return Object.assign(services, { fakeAudio: fakeAudio ?? fakeAudioService() });
}
