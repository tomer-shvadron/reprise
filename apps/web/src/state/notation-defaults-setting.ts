import { DEFAULT_NOTATION_STRINGS_SETTING, DEFAULT_NOTATION_VOCALS_SETTING } from './app-settings';
import type { NotationDefaults } from './notation-defaults';
import type { SettingsStore } from './settings';

/** Apart from `notation-defaults.ts`, so the import worker does not bundle every app setting. */
export function notationDefaultsOf(settings: Pick<SettingsStore, 'get'>): NotationDefaults {
  return {
    strings: settings.get(DEFAULT_NOTATION_STRINGS_SETTING),
    vocals: settings.get(DEFAULT_NOTATION_VOCALS_SETTING),
  };
}
