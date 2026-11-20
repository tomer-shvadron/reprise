import { HQ_BUDGET_BYTES } from '@reprise/audio';

import {
  COUNT_IN_SETTING,
  GM_TIER_BYPASS_SETTING,
  MASTER_VOLUME_SETTING,
  MEMORY_BUDGET_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
} from '@/state/app-settings';
import { MEMORY_BUDGET_RANGE } from '@/state/playback';
import type { SettingDef, SettingsStore } from '@/state/settings';

const LEGACY_HANDLES = [
  COUNT_IN_SETTING,
  METRONOME_ON_SETTING,
  METRONOME_VOLUME_SETTING,
  MASTER_VOLUME_SETTING,
  GM_TIER_BYPASS_SETTING,
  MEMORY_BUDGET_SETTING,
] as const;

/** The old home of these preferences; now only read once, to move them into the settings table (#343). */
export const TRANSPORT_STORAGE_KEY = 'reprise.transport';

/** The transport settings the old blob held; tempo and loop are per song and are not kept. */
export interface TransportPreferences {
  countIn: boolean;
  metronome: { on: boolean; volume: number };
  masterVolume: number;
  gmTierBypass: boolean;
  memoryBudgetBytes: number;
}

export const DEFAULT_TRANSPORT_PREFERENCES: TransportPreferences = {
  countIn: false,
  metronome: { on: false, volume: 0.7 },
  masterVolume: 1,
  gmTierBypass: true,
  memoryBudgetBytes: HQ_BUDGET_BYTES,
};

const isLevel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return found;
}

export function readTransportPreferences(
  storage: () => Storage = () => window.localStorage,
): TransportPreferences {
  const defaults = DEFAULT_TRANSPORT_PREFERENCES;
  let stored: unknown;
  try {
    stored = JSON.parse(storage().getItem(TRANSPORT_STORAGE_KEY) ?? 'null');
  } catch {
    return defaults;
  }
  const countIn = field(stored, 'countIn');
  const metronome = field(stored, 'metronome');
  const on = field(metronome, 'on');
  const volume = field(metronome, 'volume');
  const masterVolume = field(stored, 'masterVolume');
  const gmTierBypass = field(stored, 'gmTierBypass');
  const memoryBudgetBytes = field(stored, 'memoryBudgetBytes');
  return {
    countIn: typeof countIn === 'boolean' ? countIn : defaults.countIn,
    metronome: {
      on: typeof on === 'boolean' ? on : defaults.metronome.on,
      volume: isLevel(volume) ? volume : defaults.metronome.volume,
    },
    masterVolume: isLevel(masterVolume) ? masterVolume : defaults.masterVolume,
    gmTierBypass: typeof gmTierBypass === 'boolean' ? gmTierBypass : defaults.gmTierBypass,
    memoryBudgetBytes:
      typeof memoryBudgetBytes === 'number' &&
      Number.isFinite(memoryBudgetBytes) &&
      memoryBudgetBytes >= MEMORY_BUDGET_RANGE.min &&
      memoryBudgetBytes <= MEMORY_BUDGET_RANGE.max
        ? memoryBudgetBytes
        : defaults.memoryBudgetBytes,
  };
}

/**
 * The one-time move of the old `reprise.transport` blob into the settings table: the six values
 * become their own keys and the old key is removed. Call it once the settings have hydrated.
 *
 * It never loses the blob: it does nothing unless the table loaded (a failed load hydrates with
 * defaults, and the writes would fail too), nothing when any of the keys is already a loaded row
 * (an earlier move happened), and it removes the blob only after every write was confirmed.
 * A value set this session before hydration is the user's newer choice and is kept.
 */
export async function importLegacyTransportPreferences(
  settings: SettingsStore,
  storage: () => Storage = () => window.localStorage,
): Promise<void> {
  const rows = settings.loadedRows();
  if (!rows) return;
  try {
    if (storage().getItem(TRANSPORT_STORAGE_KEY) === null) return;
    if (LEGACY_HANDLES.some((handle) => rows.has(handle.key))) return;
    const old = readTransportPreferences(storage);
    const keep = <T>(handle: SettingDef<T>, value: T) => {
      if (!settings.isStored(handle)) settings.set(handle, value);
    };
    keep(COUNT_IN_SETTING, old.countIn);
    keep(METRONOME_ON_SETTING, old.metronome.on);
    keep(METRONOME_VOLUME_SETTING, old.metronome.volume);
    keep(MASTER_VOLUME_SETTING, old.masterVolume);
    keep(GM_TIER_BYPASS_SETTING, old.gmTierBypass);
    keep(MEMORY_BUDGET_SETTING, old.memoryBudgetBytes);
    if (await settings.settled()) storage().removeItem(TRANSPORT_STORAGE_KEY);
  } catch {
    // Storage can be disabled; the defaults stand and the blob, if any, is tried again next time.
  }
}
