import { afterEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS, THEME_SETTING } from '@/state/app-settings';
import { createSettingsStore, type SettingDef, type SettingsStore } from '@/state/settings';
import { memoryStorage } from '@/test/memory-local-storage';

import { LIBRARY_SORT_SETTING } from '../search';
import { uniqueDbName } from '../test-support';

import { openLibraryDb, type RepriseDb } from './schema';
import { createDexieSettingsBackend } from './settings-backend';

const open: RepriseDb[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/**
 * Every setting the app registers, with a value that is not its default. A new setting must add
 * its sample here, which is what makes "survives a relaunch" a property of each one.
 */
const REGISTERED: readonly SettingDef<unknown>[] = [...APP_SETTINGS, LIBRARY_SORT_SETTING];
const SAMPLES: Record<string, unknown> = {
  'appearance.theme': 'light',
  'playback.countIn': true,
  'playback.metronomeOn': true,
  'playback.metronomeVolume': 0.25,
  'playback.masterVolume': 0.6,
  'playback.gmTierBypass': false,
  'sounds.memoryBudgetBytes': 256 * 1024 * 1024,
  'layout.bottomDockOpen': true,
  'layout.bottomDockHeight': 300,
  'layout.rightPanelOpen': true,
  'layout.rightPanelWidth': 400,
  'library.sort': 'artist',
};

/** One app run: a database, a store over its table, and the `localStorage` early settings use. */
function launch(name: string, local: Storage) {
  const db = openLibraryDb(name);
  open.push(db);
  const store = createSettingsStore({ local: () => local });
  const backend = createDexieSettingsBackend(db.settings);
  return { db, store, backend };
}

// Resolves once every write has been committed, so a closed database really holds the value.
const settle = async (store: SettingsStore) => {
  await store.whenHydrated();
  expect(await store.settled()).toBe(true);
};

describe('the settings table across a relaunch', () => {
  it.each(REGISTERED.map((def) => [def.key, def] as const))(
    '%s survives a relaunch',
    async (key, def) => {
      if (!(key in SAMPLES)) throw new Error(`add a sample for ${key}`);
      const sample = SAMPLES[key];
      expect(sample).not.toEqual(def.default);
      const name = uniqueDbName();
      const local = memoryStorage();

      const first = launch(name, local);
      await first.store.attach(first.backend);
      first.store.set(def, sample);
      await settle(first.store);
      first.db.close();

      // A fresh Dexie instance and a fresh store, as after a relaunch.
      const second = launch(name, local);
      await second.store.attach(second.backend);
      expect(second.store.get(def)).toEqual(sample);
    },
  );

  it('has a sample for no unregistered key', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(REGISTERED.map((def) => def.key).sort());
  });

  it('keeps the early theme out of the table', async () => {
    const local = memoryStorage();
    const run = launch(uniqueDbName(), local);
    await run.store.attach(run.backend);
    run.store.set(THEME_SETTING, 'dark');
    await settle(run.store);

    expect(local.getItem('reprise.theme')).toBe('dark');
    expect(await run.db.settings.get(THEME_SETTING.key)).toBeUndefined();
  });

  it('reads the library sort from the row the library has always written', async () => {
    const run = launch(uniqueDbName(), memoryStorage());
    await run.db.settings.put({ key: 'library.sort', value: 'imported' });
    await run.store.attach(run.backend);

    expect(run.store.get(LIBRARY_SORT_SETTING)).toBe('imported');
  });

  it('removes a row on reset', async () => {
    const run = launch(uniqueDbName(), memoryStorage());
    await run.store.attach(run.backend);
    run.store.set(LIBRARY_SORT_SETTING, 'artist');
    await settle(run.store);
    run.store.reset([LIBRARY_SORT_SETTING]);
    await settle(run.store);

    expect(await run.db.settings.get('library.sort')).toBeUndefined();
  });
});
