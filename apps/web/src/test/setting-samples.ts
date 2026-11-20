import { SETTINGS_SECTIONS } from '@/app/settings-sections';
import { LIBRARY_SORT_SETTING } from '@/features/library/search';
import { APP_SETTINGS } from '@/state/app-settings';
import type { SettingDef } from '@/state/settings';

/**
 * Every setting the app registers: the shell's, the library's and every Settings section's,
 * deduplicated by key. A section's handles join by being listed in `app/settings-sections.ts`, so
 * a new section gets the relaunch round trip and the restore-defaults check with no edit here.
 */
export const REGISTERED: readonly SettingDef<unknown>[] = [
  ...new Map(
    [...APP_SETTINGS, LIBRARY_SORT_SETTING, ...SETTINGS_SECTIONS.flatMap((s) => s.settings)].map(
      (def) => [def.key, def] as const,
    ),
  ).values(),
];

/**
 * A value that is not the default, per key. A new setting must add its sample here, which is what
 * makes "survives a relaunch" and "restores its default" properties of each one.
 */
export const SAMPLES: Record<string, unknown> = {
  'appearance.theme': 'light',
  'playback.countIn': true,
  'playback.metronomeOn': true,
  'playback.metronomeVolume': 0.25,
  'playback.masterVolume': 0.6,
  'playback.gmTierBypass': false,
  'sounds.memoryBudgetBytes': 256 * 1024 * 1024,
  'playback.followPlayhead': false,
  'score.defaultViewMode': 'continuous',
  'score.defaultZoom': 1.5,
  'layout.bottomDockOpen': true,
  'layout.bottomDockHeight': 300,
  'layout.rightPanelOpen': true,
  'layout.rightPanelWidth': 400,
  'layout.practiceZoom': 2,
  'library.sort': 'artist',
};
