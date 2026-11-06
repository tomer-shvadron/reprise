import { describe, expect, it } from 'vitest';

import { memoryStorage } from '@/test/services';

import {
  DEFAULT_TRANSPORT_PREFERENCES,
  readTransportPreferences,
  TRANSPORT_STORAGE_KEY,
  writeTransportPreferences,
} from './preferences';

const stored = (value: string) => {
  const storage = memoryStorage();
  storage.setItem(TRANSPORT_STORAGE_KEY, value);
  return () => storage;
};

describe('transport preferences', () => {
  it('fall back to the defaults for nothing stored or invalid JSON', () => {
    expect(readTransportPreferences(() => memoryStorage())).toEqual(DEFAULT_TRANSPORT_PREFERENCES);
    expect(readTransportPreferences(stored('{nope'))).toEqual(DEFAULT_TRANSPORT_PREFERENCES);
  });

  it('keep each valid field of a partial or out-of-range object', () => {
    expect(
      readTransportPreferences(
        stored(JSON.stringify({ countIn: true, metronome: { volume: 3 }, masterVolume: 0.2 })),
      ),
    ).toEqual({ countIn: true, metronome: { on: false, volume: 0.7 }, masterVolume: 0.2 });
  });

  it('round-trip, and survive a storage that throws', () => {
    const storage = memoryStorage();
    const prefs = { countIn: true, metronome: { on: true, volume: 0.3 }, masterVolume: 0.9 };
    writeTransportPreferences(prefs, () => storage);
    expect(readTransportPreferences(() => storage)).toEqual(prefs);

    const broken = (): Storage => {
      throw new Error('disabled');
    };
    expect(readTransportPreferences(broken)).toEqual(DEFAULT_TRANSPORT_PREFERENCES);
    expect(() => {
      writeTransportPreferences(prefs, broken);
    }).not.toThrow();
  });
});
