import type { ComponentType } from 'react';

import type { SettingKey } from '@/state/settings';

export interface SettingsSection {
  /** Stable and kebab-case; `openSettings('playback')` names it. */
  id: string;
  title: string;
  /** What "Restore defaults" resets; a key may belong to one section only. */
  settings: readonly SettingKey[];
  Component: ComponentType;
}

/** Throws on a repeated section id or a setting key two sections both reset. */
export function checkSections(sections: readonly SettingsSection[]): void {
  const ids = new Set<string>();
  const keys = new Map<string, string>();
  for (const section of sections) {
    if (ids.has(section.id)) throw new Error(`Two settings sections share the id "${section.id}"`);
    ids.add(section.id);
    for (const { key } of section.settings) {
      const owner = keys.get(key);
      if (owner !== undefined) {
        throw new Error(`The setting "${key}" is in both "${owner}" and "${section.id}"`);
      }
      keys.set(key, section.id);
    }
  }
}
