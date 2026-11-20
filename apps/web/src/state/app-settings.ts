import { HQ_BUDGET_BYTES } from '@reprise/audio';
import { z } from 'zod';

import { defineSetting, type SettingDef } from './settings';
import { MEMORY_BUDGET_RANGE } from './playback';

/** The key the pre-paint script `public/theme-bootstrap.js` reads; keep the two in step. */
export const THEME_STORAGE_KEY = 'reprise.theme';

const level = z.number().min(0).max(1);

export const THEME_SETTING = defineSetting({
  key: 'appearance.theme',
  schema: z.enum(['system', 'light', 'dark']),
  default: 'system',
  early: { storageKey: THEME_STORAGE_KEY },
});
export const COUNT_IN_SETTING = defineSetting({
  key: 'playback.countIn',
  schema: z.boolean(),
  default: false,
});
export const METRONOME_ON_SETTING = defineSetting({
  key: 'playback.metronomeOn',
  schema: z.boolean(),
  default: false,
});
export const METRONOME_VOLUME_SETTING = defineSetting({
  key: 'playback.metronomeVolume',
  schema: level,
  default: 0.7,
});
export const MASTER_VOLUME_SETTING = defineSetting({
  key: 'playback.masterVolume',
  schema: level,
  default: 1,
});
export const GM_TIER_BYPASS_SETTING = defineSetting({
  key: 'playback.gmTierBypass',
  schema: z.boolean(),
  default: true,
});
export const MEMORY_BUDGET_SETTING = defineSetting({
  key: 'sounds.memoryBudgetBytes',
  schema: z.number().min(MEMORY_BUDGET_RANGE.min).max(MEMORY_BUDGET_RANGE.max),
  default: HQ_BUDGET_BYTES,
});
export const RIGHT_PANEL_OPEN_SETTING = defineSetting({
  key: 'layout.rightPanelOpen',
  schema: z.boolean(),
  default: false,
});
/** A width outside the panel's range is clamped by the ui store, so the schema only needs a number. */
export const RIGHT_PANEL_WIDTH_SETTING = defineSetting({
  key: 'layout.rightPanelWidth',
  schema: z.number().positive(),
  default: 320,
});

/** Every handle the app shell defines; the relaunch test walks this list. */
export const APP_SETTINGS: readonly SettingDef<unknown>[] = [
  THEME_SETTING,
  COUNT_IN_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
  MASTER_VOLUME_SETTING,
  GM_TIER_BYPASS_SETTING,
  MEMORY_BUDGET_SETTING,
  RIGHT_PANEL_OPEN_SETTING,
  RIGHT_PANEL_WIDTH_SETTING,
];
