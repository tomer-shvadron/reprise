import type { Track } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createSettingsStore } from '@/state/settings';
import { memoryStorage } from '@/test/memory-local-storage';

import {
  DEFAULT_SOUND_SETTINGS,
  EMILYGUITAR_FIVE_VOICES,
  createDefaultSounds,
  soundFamilyOf,
} from './default-sounds';
import { curatedPack } from './curated-packs';
import { PACK_FAMILIES } from './manifest';

const fretted = (program: number) => ({ kind: 'fretted' as const, program });

function trackOf(program: number): Track {
  const track = score().track('guitar', { program }).bar().build().tracks[0];
  if (!track) throw new Error('no track');
  return track;
}

describe('soundFamilyOf', () => {
  it.each([
    [0, 'keys'],
    [23, 'keys'],
    [24, 'acoustic-guitar'],
    [25, 'acoustic-guitar'],
    [26, 'electric-guitar'],
    [27, 'electric-guitar'],
    [29, 'electric-guitar'],
    [30, 'electric-guitar'],
    [31, 'electric-guitar'],
    [32, 'bass'],
    [39, 'bass'],
    [40, 'orchestral'],
    [52, 'orchestral'],
    [79, 'orchestral'],
    [80, 'other'],
    [104, 'other'],
  ])('puts program %i in %s', (program, family) => {
    expect(soundFamilyOf(fretted(program))).toBe(family);
  });

  it('takes a drum track from its kind, whatever its program', () => {
    expect(soundFamilyOf({ kind: 'drums', program: 25 })).toBe('drums');
  });
});

describe('the family default settings', () => {
  it('has one handle per family under sounds.default.<family>', () => {
    expect(Object.values(DEFAULT_SOUND_SETTINGS).map((def) => def.key)).toEqual([
      'sounds.default.electricGuitar',
      'sounds.default.acousticGuitar',
      'sounds.default.bass',
      'sounds.default.drums',
      'sounds.default.keys',
      'sounds.default.orchestral',
      'sounds.default.other',
    ]);
  });

  it('defaults both guitar families to Emilyguitar Five voices and the rest to GM', () => {
    for (const family of PACK_FAMILIES) {
      const expected =
        family === 'electric-guitar' || family === 'acoustic-guitar'
          ? EMILYGUITAR_FIVE_VOICES
          : 'gm';
      expect(DEFAULT_SOUND_SETTINGS[family].default).toEqual(expected);
    }
  });
});

describe('EMILYGUITAR_FIVE_VOICES', () => {
  it('names a curated pack and one of its instruments', () => {
    const pack = curatedPack(EMILYGUITAR_FIVE_VOICES.packId);
    expect(pack?.instruments.map((instrument) => instrument.key)).toContain(
      EMILYGUITAR_FIVE_VOICES.instrument,
    );
  });
});

describe('createDefaultSounds', () => {
  const store = () => createSettingsStore({ local: () => memoryStorage() });

  it('returns the pack for a guitar and nothing for a family set to GM', () => {
    const defaults = createDefaultSounds(store());
    const guitar = defaults.get(trackOf(29));
    expect(guitar).toEqual({ packId: 'qxmLveBRBWt8', instrument: 'five-voices' });
    expect(defaults.get(trackOf(33))).toBeUndefined();
  });

  it('follows a stored choice and notifies on a change', () => {
    const settings = store();
    const defaults = createDefaultSounds(settings);
    const listener = vi.fn();
    const off = defaults.subscribe(listener);
    settings.set(DEFAULT_SOUND_SETTINGS['electric-guitar'], 'gm');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(defaults.get(trackOf(29))).toBeUndefined();
    settings.set(DEFAULT_SOUND_SETTINGS.bass, { packId: 'aBassPack001' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(defaults.get(trackOf(33))).toEqual({
      packId: 'aBassPack001',
    });
    off();
    settings.set(DEFAULT_SOUND_SETTINGS.keys, { packId: 'aKeysPack001' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
