import { HQ_BUDGET_BYTES } from '@reprise/audio';
import { write } from '@reprise/formats';
import { removeBar } from '@reprise/model';
import { describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import {
  COUNT_IN_SETTING,
  GM_TIER_BYPASS_SETTING,
  MASTER_VOLUME_SETTING,
  MEMORY_BUDGET_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
} from '@/state/app-settings';
import { createDocumentStore } from '@/state/document';
import { createPlaybackStore } from '@/state/playback';
import { createSelectionStore } from '@/state/selection';
import { createSettingsStore } from '@/state/settings';
import { createTestServices, fakeAudioService, fakePlatform, memoryStorage } from '@/test/services';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { installTransport } from './install-transport';
import { TRANSPORT_STORAGE_KEY } from './preferences';
import { createTransportUi } from './transport-ui';

// Each call builds the song afresh with new ids, so each returns different bytes.
const bytes = async () => (await write(fourBars(), 'reprise')).bytes;

const MB = 1024 * 1024;

/** A store already loaded from `rows`, as after a relaunch. */
async function storeWith(rows: [string, unknown][] = []) {
  const backend = createMemorySettingsBackend(rows);
  const settings = createTestSettings(backend);
  await settings.whenHydrated();
  return { backend, settings };
}

function transportDeps() {
  return {
    audio: fakeAudioService(),
    playback: createPlaybackStore(),
    document: createDocumentStore({ platform: fakePlatform() }),
    selection: createSelectionStore(),
    transport: createTransportUi(),
  };
}

describe('installTransport', () => {
  it('applies the stored preferences to the audio service on hydration', async () => {
    const backend = createMemorySettingsBackend([
      [COUNT_IN_SETTING.key, true],
      [METRONOME_ON_SETTING.key, true],
      [METRONOME_VOLUME_SETTING.key, 0.4],
      [MASTER_VOLUME_SETTING.key, 0.5],
      [GM_TIER_BYPASS_SETTING.key, false],
      [MEMORY_BUDGET_SETTING.key, 128 * MB],
    ]);
    const settings = createSettingsStore({ local: () => memoryStorage() });
    const services = createTestServices({ settings });
    await settings.attach(backend);
    expect(services.fakeAudio.setCountIn).toHaveBeenLastCalledWith(true);
    expect(services.fakeAudio.setMetronome).toHaveBeenLastCalledWith(true, 0.4);
    expect(services.fakeAudio.setMasterVolume).toHaveBeenLastCalledWith(0.5);
    expect(services.fakeAudio.setGmTierBypass).toHaveBeenLastCalledWith(false);
    expect(services.fakeAudio.setMemoryBudget).toHaveBeenLastCalledWith(128 * MB);
  });

  it('starts from the defaults before anything is stored', async () => {
    const { settings } = await storeWith();
    const services = createTestServices({ settings });
    expect(services.fakeAudio.setCountIn).toHaveBeenCalledWith(false);
    expect(services.fakeAudio.setMetronome).toHaveBeenCalledWith(false, 0.7);
    expect(services.fakeAudio.setMasterVolume).toHaveBeenCalledWith(1);
    expect(services.fakeAudio.setGmTierBypass).toHaveBeenCalledWith(true);
    expect(services.fakeAudio.setMemoryBudget).toHaveBeenCalledWith(HQ_BUDGET_BYTES);
  });

  it('writes a playback change to the store and the table, and a store change to the audio', async () => {
    const { backend, settings } = await storeWith();
    const services = createTestServices({ settings });
    mirrorAudio(services);

    services.audio.setCountIn(true);
    services.audio.setMetronome(true, 0.3);
    services.audio.setMasterVolume(0.6);
    services.audio.setGmTierBypass(false);
    services.audio.setMemoryBudget(128 * MB);
    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
    expect(settings.get(METRONOME_ON_SETTING)).toBe(true);
    expect(settings.get(METRONOME_VOLUME_SETTING)).toBe(0.3);
    expect(settings.get(MASTER_VOLUME_SETTING)).toBe(0.6);
    expect(settings.get(GM_TIER_BYPASS_SETTING)).toBe(false);
    expect(settings.get(MEMORY_BUDGET_SETTING)).toBe(128 * MB);
    expect(backend.rows.get(COUNT_IN_SETTING.key)).toBe(true);

    services.fakeAudio.setCountIn.mockClear();
    settings.set(COUNT_IN_SETTING, false);
    expect(services.fakeAudio.setCountIn).toHaveBeenCalledExactlyOnceWith(false);
    expect(services.playback.getState().settings.countIn).toBe(false);
  });

  it('does not loop: one change reaches each side once', async () => {
    const { settings } = await storeWith();
    const services = createTestServices({ settings });
    mirrorAudio(services);
    const writes = vi.fn();
    settings.subscribe(MASTER_VOLUME_SETTING, writes);
    services.fakeAudio.setMasterVolume.mockClear();

    services.audio.setMasterVolume(0.5);

    expect(writes).toHaveBeenCalledTimes(1);
    expect(services.fakeAudio.setMasterVolume).toHaveBeenCalledTimes(1);
  });

  it('keeps the unapplied keys of a hydration from being written back as defaults', async () => {
    const backend = createMemorySettingsBackend([
      [COUNT_IN_SETTING.key, true],
      [MASTER_VOLUME_SETTING.key, 0.5],
    ]);
    const settings = createSettingsStore({ local: () => memoryStorage() });
    const services = createTestServices({ settings });
    mirrorAudio(services);
    await settings.attach(backend);
    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
    expect(settings.get(MASTER_VOLUME_SETTING)).toBe(0.5);
    expect(services.playback.getState().settings.masterVolume).toBe(0.5);
  });

  const LEGACY = JSON.stringify({
    version: 1,
    countIn: true,
    metronome: { on: true, volume: 0.4 },
    masterVolume: 0.5,
  });

  /** Runs the transport over `settings` and lets its one-time import finish. */
  async function importWith(
    settings: ReturnType<typeof createTestSettings>,
    legacy: Storage,
  ): Promise<void> {
    const stop = installTransport({ ...transportDeps(), settings, legacyStorage: () => legacy });
    await settings.whenHydrated();
    await settings.settled();
    // The import continues after `settled` resolves; two ticks let its removal run.
    await Promise.resolve();
    await Promise.resolve();
    stop();
  }

  it('imports the old localStorage blob once, and removes it after the writes', async () => {
    const legacy = memoryStorage();
    legacy.setItem(TRANSPORT_STORAGE_KEY, LEGACY);
    const { backend, settings } = await storeWith();

    await importWith(settings, legacy);

    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
    expect(settings.get(METRONOME_VOLUME_SETTING)).toBe(0.4);
    expect(settings.get(MASTER_VOLUME_SETTING)).toBe(0.5);
    expect(backend.rows.get(MASTER_VOLUME_SETTING.key)).toBe(0.5);
    expect(legacy.getItem(TRANSPORT_STORAGE_KEY)).toBeNull();
  });

  it('keeps the blob when the table failed to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const legacy = memoryStorage();
    legacy.setItem(TRANSPORT_STORAGE_KEY, LEGACY);
    const settings = createSettingsStore({ local: () => memoryStorage() });
    await settings.attach({
      ...createMemorySettingsBackend(),
      load: () => Promise.reject(new Error('VersionError')),
    });

    await importWith(settings, legacy);

    expect(legacy.getItem(TRANSPORT_STORAGE_KEY)).toBe(LEGACY);
    expect(settings.get(COUNT_IN_SETTING)).toBe(false);
  });

  it('keeps the blob when a write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const legacy = memoryStorage();
    legacy.setItem(TRANSPORT_STORAGE_KEY, LEGACY);
    const settings = createSettingsStore({ local: () => memoryStorage() });
    await settings.attach({
      ...createMemorySettingsBackend(),
      put: () => Promise.reject(new Error('quota')),
    });

    await importWith(settings, legacy);

    expect(legacy.getItem(TRANSPORT_STORAGE_KEY)).toBe(LEGACY);
  });

  it('imports the rest and removes the blob when one value was set before hydration', async () => {
    const legacy = memoryStorage();
    legacy.setItem(TRANSPORT_STORAGE_KEY, LEGACY);
    const backend = createMemorySettingsBackend();
    const settings = createSettingsStore({ local: () => memoryStorage() });
    settings.set(MASTER_VOLUME_SETTING, 0.9);
    await settings.attach(backend);

    await importWith(settings, legacy);

    expect(settings.get(MASTER_VOLUME_SETTING)).toBe(0.9);
    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
    expect(backend.rows.get(MASTER_VOLUME_SETTING.key)).toBe(0.9);
    expect(legacy.getItem(TRANSPORT_STORAGE_KEY)).toBeNull();
  });

  it('leaves the old blob alone when the table already holds a preference', async () => {
    const legacy = memoryStorage();
    legacy.setItem(TRANSPORT_STORAGE_KEY, JSON.stringify({ version: 1, countIn: true }));
    const { settings } = await storeWith([[MASTER_VOLUME_SETTING.key, 0.5]]);

    await importWith(settings, legacy);

    expect(settings.get(COUNT_IN_SETTING)).toBe(false);
  });

  it('keys the speed by the bytes, so a same-named different song starts at 100%', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    const { document, audio, playback } = services;
    const first = await bytes();
    await document.getState().openBytes('a.reprise', first);
    audio.setTempo('percent', 75);
    await document.getState().openBytes('a.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 100 });
    // The first song's bytes under a new name are still that song.
    await document.getState().openBytes('renamed.reprise', first);
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 75 });
  });

  it('keeps the speed across a save, for the saved file reopened', async () => {
    const written: Uint8Array[] = [];
    const services = createTestServices({
      platform: fakePlatform({
        writeHandle: (_handle, data) => {
          written.push(data);
          return Promise.resolve();
        },
      }),
    });
    mirrorAudio(services);
    const { document, audio, playback } = services;
    const first = await bytes();
    await document.getState().openBytes('a.reprise', first, { handle: '/music/a.reprise' });
    audio.setTempo('percent', 75);
    const bars = document.getState().score?.masterBars ?? [];
    document.getState().apply(removeBar({ masterBarId: bars[3]?.id ?? '' }));
    await document.getState().save();
    const saved = written[0];
    if (!saved) throw new Error('nothing was saved');
    expect(saved).not.toEqual(first);

    await document.getState().openBytes('b.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 100 });
    await document.getState().openBytes('a.reprise', saved);
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 75 });
  });

  it('announces each sound load stage once, not its progress', () => {
    const services = createTestServices();
    const { playback, transport } = services;
    const spoken: string[] = [];
    transport.subscribe(({ announcement }, previous) => {
      if (announcement && announcement !== previous.announcement) spoken.push(announcement.text);
    });
    const sounds = (loaded: number) => {
      playback.setState({ sounds: { status: 'loading', loaded, total: 100, error: undefined } });
    };
    sounds(1);
    sounds(2);
    sounds(50);
    playback.setState({
      sounds: { status: 'error', loaded: 50, total: 100, error: 'missing' },
    });
    expect(spoken).toEqual(['Loading sounds…', 'Sounds unavailable']);
  });

  it('retargets an active loop to a new selection and keeps it when the selection clears', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    await services.document.getState().openBytes('a.reprise', await bytes());
    const bars = services.document.getState().score?.masterBars ?? [];
    const whole = { startBar: bars[0]?.id ?? '', endBar: bars[3]?.id ?? '' };
    const middle = { startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' };

    services.selection.getState().selectBars(middle);
    expect(services.playback.getState().settings.loop).toBeUndefined();
    services.audio.setLoop(whole);
    services.selection.getState().selectBars(undefined);
    services.selection.getState().selectBars(middle);
    expect(services.playback.getState().settings.loop).toEqual(middle);
    services.selection.getState().selectBars(undefined);
    expect(services.playback.getState().settings.loop).toEqual(middle);
  });

  it('turns the loop off when an edit deletes one of its bars', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    await services.document.getState().openBytes('a.reprise', await bytes());
    const bars = services.document.getState().score?.masterBars ?? [];
    services.audio.setLoop({ startBar: bars[1]?.id ?? '', endBar: bars[3]?.id ?? '' });
    services.document.getState().apply(removeBar({ masterBarId: bars[3]?.id ?? '' }));
    expect(services.playback.getState().settings.loop).toBeUndefined();
  });
});
