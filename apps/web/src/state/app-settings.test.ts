import { HQ_BUDGET_BYTES } from '@reprise/audio';
import { describe, expect, it } from 'vitest';

import { createMemorySettingsBackend } from '@/test/settings-backend';

import {
  APP_SETTINGS,
  COUNT_IN_SETTING,
  DEFAULT_VIEW_MODE_SETTING,
  DEFAULT_ZOOM_SETTING,
  FOLLOW_PLAYHEAD_SETTING,
  GM_TIER_BYPASS_SETTING,
  MASTER_VOLUME_SETTING,
  MEMORY_BUDGET_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
  THEME_SETTING,
} from './app-settings';
import { createSettingsStore } from './settings';

describe('the app settings', () => {
  it("give today's values over an empty table", async () => {
    const store = createSettingsStore({ local: () => window.localStorage });
    window.localStorage.removeItem('reprise.theme');
    await store.attach(createMemorySettingsBackend());

    expect(store.get(THEME_SETTING)).toBe('system');
    expect(store.get(COUNT_IN_SETTING)).toBe(false);
    expect(store.get(METRONOME_ON_SETTING)).toBe(false);
    expect(store.get(METRONOME_VOLUME_SETTING)).toBe(0.7);
    expect(store.get(MASTER_VOLUME_SETTING)).toBe(1);
    expect(store.get(GM_TIER_BYPASS_SETTING)).toBe(true);
    expect(store.get(MEMORY_BUDGET_SETTING)).toBe(HQ_BUDGET_BYTES);
    expect(store.get(FOLLOW_PLAYHEAD_SETTING)).toBe(true);
    expect(store.get(DEFAULT_VIEW_MODE_SETTING)).toBe('paged');
    expect(store.get(DEFAULT_ZOOM_SETTING)).toBe(1);
  });

  it('use unique keys', () => {
    const keys = APP_SETTINGS.map((def) => def.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
