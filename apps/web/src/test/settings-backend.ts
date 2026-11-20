import { createSettingsStore, type SettingsBackend, type SettingsStore } from '@/state/settings';

import { memoryStorage } from './memory-local-storage';

/** A settings backend over a map, with the rows exposed for assertions. */
export function createMemorySettingsBackend(
  initial: Iterable<readonly [string, unknown]> = [],
): SettingsBackend & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>(initial);
  return {
    rows,
    load: () => Promise.resolve(new Map(rows)),
    put: (key, value) => {
      rows.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      rows.delete(key);
      return Promise.resolve();
    },
  };
}

/**
 * A store over a memory backend and a private `Storage` for early settings. It is attached but
 * not hydrated when returned (the load resolves a microtask later, so it cannot be otherwise
 * synchronously): `await settings.whenHydrated()` before reading a seeded row.
 */
export function createTestSettings(
  backend: SettingsBackend = createMemorySettingsBackend(),
  local: Storage = memoryStorage(),
): SettingsStore {
  const settings = createSettingsStore({ local: () => local });
  void settings.attach(backend);
  return settings;
}
