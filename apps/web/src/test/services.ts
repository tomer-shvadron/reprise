import { vi, type Mock } from 'vitest';

import type { AudioService } from '@/app/audio/audio-service';
import { createAppServices, type AppServices, type AppServicesOptions } from '@/app/services';
import type { Platform } from '@/platform/platform';
import { createUiStore } from '@/state/ui';

const notUsed = () => Promise.reject(new Error('not used'));

/** A platform whose every call rejects unless the test overrides it. */
export function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    openFile: vi.fn(() => Promise.resolve(undefined)),
    saveFile: notUsed,
    readFile: notUsed,
    writeFile: notUsed,
    writeHandle: notUsed,
    libraryDir: notUsed,
    dataDir: notUsed,
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
    setTempo: vi.fn(),
    setLoop: vi.fn(),
    setCountIn: vi.fn(),
    setMetronome: vi.fn(),
    setTrack: vi.fn(),
    retry: vi.fn(),
    settled: vi.fn(() => Promise.resolve()),
    debug: vi.fn(() => ({})),
    dispose: vi.fn(),
  };
}

/** Real stores over a fake platform and a fake audio service, for jsdom tests. */
export function createTestServices(
  options: Partial<AppServicesOptions> = {},
): AppServices & { fakeAudio: FakeAudioService } {
  let fakeAudio: FakeAudioService | undefined;
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
  });
  return Object.assign(services, { fakeAudio: fakeAudio ?? fakeAudioService() });
}
