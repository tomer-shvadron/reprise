// WP-060 moves this key into Dexie's `settings` table.
export const TRANSPORT_STORAGE_KEY = 'reprise.transport';

/** The transport settings that outlive a reload; tempo and loop are per song and are not kept. */
export interface TransportPreferences {
  countIn: boolean;
  metronome: { on: boolean; volume: number };
  masterVolume: number;
}

export const DEFAULT_TRANSPORT_PREFERENCES: TransportPreferences = {
  countIn: false,
  metronome: { on: false, volume: 0.7 },
  masterVolume: 1,
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
  return {
    countIn: typeof countIn === 'boolean' ? countIn : defaults.countIn,
    metronome: {
      on: typeof on === 'boolean' ? on : defaults.metronome.on,
      volume: isLevel(volume) ? volume : defaults.metronome.volume,
    },
    masterVolume: isLevel(masterVolume) ? masterVolume : defaults.masterVolume,
  };
}

export function writeTransportPreferences(
  preferences: TransportPreferences,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(TRANSPORT_STORAGE_KEY, JSON.stringify({ version: 1, ...preferences }));
  } catch {
    // Storage can be disabled or full; the settings still apply for this session.
  }
}
