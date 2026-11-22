import { HQ_BUDGET_BYTES } from '@reprise/audio';
import { NotationSchema } from '@reprise/model';
import { z } from 'zod';

import { BOTTOM_PANEL_HEIGHT } from './bottom-panel-height';
import { defineSetting, type SettingDef } from './settings';
import { PANEL_WIDTH } from './panel-width';
import { MEMORY_BUDGET_RANGE } from './playback';
import { PRACTICE_ZOOM_DEFAULT, ZOOM } from './zoom';

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
export const COUNT_IN_VOLUME_SETTING = defineSetting({
  key: 'playback.countInVolume',
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
/** The ui store clamps as well, so a row from an older range still shows. */
export const RIGHT_PANEL_WIDTH_SETTING = defineSetting({
  key: 'layout.rightPanelWidth',
  schema: z.number().min(PANEL_WIDTH.rightPanel.min).max(PANEL_WIDTH.rightPanel.max),
  default: PANEL_WIDTH.rightPanel.default,
});
export const BOTTOM_DOCK_OPEN_SETTING = defineSetting({
  key: 'layout.bottomDockOpen',
  schema: z.boolean(),
  default: false,
});
/** A height outside the dock's range is clamped by the ui store, so the schema only needs a number. */
export const BOTTOM_DOCK_HEIGHT_SETTING = defineSetting({
  key: 'layout.bottomDockHeight',
  schema: z.number().positive(),
  default: BOTTOM_PANEL_HEIGHT.default,
});

export const FOLLOW_PLAYHEAD_SETTING = defineSetting({
  key: 'playback.followPlayhead',
  schema: z.boolean(),
  default: true,
});
export const DEFAULT_VIEW_MODE_SETTING = defineSetting({
  key: 'score.defaultViewMode',
  schema: z.enum(['paged', 'continuous']),
  default: 'paged',
});
export const DEFAULT_ZOOM_SETTING = defineSetting({
  key: 'score.defaultZoom',
  schema: z.number().min(ZOOM.min).max(ZOOM.max),
  default: ZOOM.default,
});
/** The notation of a fretted track the file does not choose one for (gp3, gp4, a new track). */
export const DEFAULT_NOTATION_STRINGS_SETTING = defineSetting({
  key: 'score.defaultNotationStrings',
  schema: NotationSchema,
  default: 'tab',
});
/** The same for a vocal track. */
export const DEFAULT_NOTATION_VOCALS_SETTING = defineSetting({
  key: 'score.defaultNotationVocals',
  schema: NotationSchema,
  default: 'tab',
});
/** Whether the score draws the chord diagrams a file carries; the View menu flips it. */
export const CHORD_DIAGRAMS_SETTING = defineSetting({
  key: 'score.chordDiagrams',
  schema: z.boolean(),
  default: true,
});
/** Whether the chord strip (#352) is docked above the score; off until turned on, and printed when on. */
export const CHORD_STRIP_SETTING = defineSetting({
  key: 'score.chordStrip',
  schema: z.boolean(),
  default: false,
});
/**
 * The practice mode's zoom, remembered like the panel width: the distance from the screen is the
 * one thing worth tuning there, and nothing else sets it. The normal zoom is not stored.
 */
export const PRACTICE_ZOOM_SETTING = defineSetting({
  key: 'layout.practiceZoom',
  schema: z.number().min(ZOOM.min).max(ZOOM.max),
  default: PRACTICE_ZOOM_DEFAULT,
});

/** Every handle the app shell defines; the relaunch test walks this list. */
export const APP_SETTINGS: readonly SettingDef<unknown>[] = [
  THEME_SETTING,
  COUNT_IN_SETTING,
  COUNT_IN_VOLUME_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
  MASTER_VOLUME_SETTING,
  GM_TIER_BYPASS_SETTING,
  MEMORY_BUDGET_SETTING,
  FOLLOW_PLAYHEAD_SETTING,
  DEFAULT_VIEW_MODE_SETTING,
  DEFAULT_ZOOM_SETTING,
  DEFAULT_NOTATION_STRINGS_SETTING,
  DEFAULT_NOTATION_VOCALS_SETTING,
  CHORD_DIAGRAMS_SETTING,
  CHORD_STRIP_SETTING,
  RIGHT_PANEL_OPEN_SETTING,
  RIGHT_PANEL_WIDTH_SETTING,
  BOTTOM_DOCK_OPEN_SETTING,
  BOTTOM_DOCK_HEIGHT_SETTING,
  PRACTICE_ZOOM_SETTING,
];
