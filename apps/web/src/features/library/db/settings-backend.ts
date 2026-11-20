import type { SettingsBackend, SettingsStore } from '@/state/settings';

import type { RepriseDb } from './schema';

/**
 * The settings store's backend over the `settings` table, a `{ key, value }` row per setting
 * since schema version 1, so it needs no migration.
 */
export function createDexieSettingsBackend(table: RepriseDb['settings']): SettingsBackend {
  return {
    async load() {
      const rows = await table.toArray();
      return new Map(rows.map((row) => [row.key, row.value]));
    },
    async put(key, value) {
      await table.put({ key, value });
    },
    async remove(key) {
      await table.delete(key);
    },
  };
}

/**
 * Attaches the store to the library database's `settings` table. The app calls it once the
 * library's database exists; the store ignores a second call, so StrictMode's double effect is safe.
 */
export function installSettings(services: { settings: SettingsStore }, db: RepriseDb): void {
  void services.settings.attach(createDexieSettingsBackend(db.settings));
}
