import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLibrary } from '../library';
import { LIBRARY_SORT_SETTING } from '../search';
import { uniqueDbName } from '../test-support';

import { MASTER_VOLUME_SETTING } from '@/state/app-settings';
import { createSettingsStore } from '@/state/settings';
import { TRANSPORT_STORAGE_KEY } from '@/features/transport/preferences';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices, memoryStorage } from '@/test/services';

import { openLibraryDb, type RepriseDb } from './schema';
import { installSettings } from './settings-backend';

const open: RepriseDb[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  window.localStorage.removeItem(TRANSPORT_STORAGE_KEY);
});

/**
 * One launch of the app's wiring over a database name: real services, the transport installed,
 * and the settings attached to the Dexie table through the function `app.tsx` calls.
 */
async function launch(name: string, local: Storage) {
  const db = openLibraryDb(name);
  open.push(db);
  const services = createTestServices({ settings: createSettingsStore({ local: () => local }) });
  mirrorAudio(services);
  const library = createLibrary(services, { db });
  installSettings(services, db);
  await services.settings.whenHydrated();
  return { db, services, library };
}

/** Closes the launch's database once its writes are committed, as a quit would. */
async function quit(run: Awaited<ReturnType<typeof launch>>) {
  expect(await run.services.settings.settled()).toBe(true);
  await run.library.dispose();
  run.db.close();
}

describe('relaunching the app over IndexedDB', () => {
  it('brings an audio preference and the library sort back', async () => {
    const name = uniqueDbName();
    const local = memoryStorage();

    const first = await launch(name, local);
    first.services.audio.setMasterVolume(0.4);
    first.services.audio.setCountIn(true);
    first.library.setSort('artist');
    await quit(first);

    const second = await launch(name, local);
    expect(second.services.fakeAudio.setMasterVolume).toHaveBeenLastCalledWith(0.4);
    expect(second.services.playback.getState().settings.masterVolume).toBe(0.4);
    expect(second.services.playback.getState().settings.countIn).toBe(true);
    await second.library.load();
    expect(second.library.store.getState().sort).toBe('artist');
    expect(second.services.settings.get(LIBRARY_SORT_SETTING)).toBe('artist');
  });

  it('moves the old localStorage preferences into the table once', async () => {
    window.localStorage.setItem(
      TRANSPORT_STORAGE_KEY,
      JSON.stringify({ version: 1, countIn: true, masterVolume: 0.3 }),
    );
    const name = uniqueDbName();
    const local = memoryStorage();

    const first = await launch(name, local);
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(TRANSPORT_STORAGE_KEY)).toBeNull();
    });
    expect(first.services.playback.getState().settings.masterVolume).toBe(0.3);
    await quit(first);

    const second = await launch(name, local);
    expect(await second.db.settings.get(MASTER_VOLUME_SETTING.key)).toEqual({
      key: MASTER_VOLUME_SETTING.key,
      value: 0.3,
    });
    expect(second.services.playback.getState().settings.masterVolume).toBe(0.3);
    expect(second.services.playback.getState().settings.countIn).toBe(true);
  });
});
