import { vi, type Mock } from 'vitest';

import type { AudioService } from '@/app/audio/audio-service';
import { createAppServices, type AppServices, type AppServicesOptions } from '@/app/services';
import type { Platform } from '@/platform/platform';
import { createUiStore } from '@/state/ui';
import { createMemoryStorage } from '@/test/memory-storage';

const notUsed = () => Promise.reject(new Error('not used'));

/**
 * A platform for tests. The pickers cancel and the file operations (`mkdir`, `listDir`, `move`,
 * `remove`, `readFile`, `writeFile`, `writeHandle` with a path, `libraryDir`, `dataDir`) run over an in-memory store with the
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
