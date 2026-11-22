import { SETTINGS_SECTIONS } from '@/app/settings-sections';
import { OFFERED_PACKS_SETTING } from '@/features/sounds';
import { LIBRARY_SORT_SETTING } from '@/features/library/search';
import { APP_SETTINGS } from '@/state/app-settings';
import type { SettingDef } from '@/state/settings';

/**
 * Every setting the app registers: the shell's, the library's, the sounds feature's and every
 * Settings section's, deduplicated by key. A section's handles join by being listed in `app/settings-sections.ts`, so
 * a new section gets the relaunch round trip and the restore-defaults check with no edit here.
 */
export const REGISTERED: readonly SettingDef<unknown>[] = [
  ...new Map(
    [
      ...APP_SETTINGS,
      LIBRARY_SORT_SETTING,
      // Belongs to no section: only the download offer reads it.
      OFFERED_PACKS_SETTING,
      ...SETTINGS_SECTIONS.flatMap((s) => s.settings),
    ].map((def) => [def.key, def] as const),
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
  'playback.countInVolume': 0.45,
  'playback.masterVolume': 0.6,
  'playback.gmTierBypass': false,
  'playback.channelEffects': false,
  'sounds.memoryBudgetBytes': 256 * 1024 * 1024,
  'playback.followPlayhead': false,
  'score.defaultViewMode': 'continuous',
  'score.defaultZoom': 1.5,
  'score.defaultNotationStrings': 'both',
  'score.defaultNotationVocals': 'standard',
  'score.chordDiagrams': false,
  'score.chordStrip': true,
  'editing.sound': false,
  'layout.bottomDockOpen': true,
  'layout.bottomDockHeight': 300,
  'layout.rightPanelOpen': true,
  'layout.rightPanelWidth': 400,
  'layout.practiceZoom': 2,
  'library.sort': 'artist',
  'sounds.default.electricGuitar': 'gm',
  'sounds.default.acousticGuitar': 'gm',
  'sounds.default.bass': { packId: 'aBassPack001', instrument: 'fingered' },
  'sounds.default.drums': { packId: 'aDrumPack001' },
  'sounds.default.keys': { packId: 'aKeysPack001' },
  'sounds.default.orchestral': { packId: 'anOrchPack01' },
  'sounds.default.other': { packId: 'anOtherPack1' },
  'sounds.offeredPacks': ['qxmLveBRBWt8'],
  'keyboard.shortcuts': { 'view.toggleViewMode': { key: 'F5' } },
};
