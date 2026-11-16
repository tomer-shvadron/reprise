import { describe, expect, it } from 'vitest';

import {
  EFFECT_FAMILIES,
  EFFECT_PRESETS,
  EFFECT_PRESET_IDS,
  EFFECT_STAGES,
  presetFamilyOf,
  resolveEffects,
  stagesOf,
} from './presets';
import type { EffectFamily } from './presets';

const fretted = (program: number) => ({ kind: 'fretted' as const, program });

function familyOfProgram(program: number): EffectFamily {
  return presetFamilyOf(fretted(program));
}

describe('presetFamilyOf', () => {
  it('maps every GM program to a family', () => {
    for (let program = 0; program < 128; program += 1) {
      expect(EFFECT_FAMILIES).toContain(familyOfProgram(program));
    }
  });

  it.each([
    [29, 'overdrive'],
    [30, 'distortion'],
    [24, 'acoustic'],
    [25, 'acoustic'],
    [26, 'clean'],
    [27, 'clean'],
    [28, 'clean'],
    [31, 'clean'],
    [32, 'bass'],
    [39, 'bass'],
    [0, 'keys'],
    [23, 'keys'],
    [40, 'other'],
    [127, 'other'],
  ] as const)('program %i is %s', (program, family) => {
    expect(familyOfProgram(program)).toBe(family);
  });

  it('reads the kind first: a drum track is drums whatever its kit', () => {
    for (const program of [0, 25, 30, 127]) {
      expect(presetFamilyOf({ kind: 'drums', program })).toBe('drums');
    }
    expect(presetFamilyOf({ kind: 'pitched', program: 25 })).toBe('acoustic');
  });
});

describe('EFFECT_PRESETS', () => {
  it('has a preset for each family, plus fuzz and off', () => {
    expect([...EFFECT_PRESET_IDS].sort()).toEqual([...EFFECT_FAMILIES, 'fuzz', 'off'].sort());
    expect(EFFECT_PRESETS.off).toEqual({});
  });

  it('keeps every feedback below 0.6 and every stage a known one', () => {
    for (const preset of Object.values(EFFECT_PRESETS)) {
      expect(preset.delay?.feedback ?? 0).toBeLessThan(0.6);
      for (const stage of Object.keys(preset))
        expect(EFFECT_STAGES as readonly string[]).toContain(stage);
    }
  });
});

describe('resolveEffects', () => {
  const guitar = (sound?: { preset?: string; packId?: string }, program = 30) => ({
    ...fretted(program),
    ...(sound && { sound }),
  });
  const GM_ON = { tier: 'gm', gmTierBypass: true } as const;
  const GM_OFF = { tier: 'gm', gmTierBypass: false } as const;
  const HQ = { tier: 'hq', gmTierBypass: true } as const;

  it('uses a known preset on either tier, whatever the bypass, off included', () => {
    for (const context of [GM_ON, GM_OFF, HQ]) {
      expect(resolveEffects(guitar({ preset: 'fuzz' }), context)).toEqual({
        preset: 'fuzz',
        automatic: false,
      });
      expect(resolveEffects(guitar({ preset: 'off' }, 30), context)).toEqual({
        preset: 'off',
        automatic: false,
      });
    }
  });

  it('is the family on the HQ tier when absent or unknown', () => {
    expect(resolveEffects(guitar(), HQ)).toEqual({ preset: 'distortion', automatic: true });
    expect(resolveEffects(guitar({ preset: 'from-the-future' }, 29), HQ)).toEqual({
      preset: 'overdrive',
      automatic: true,
    });
  });

  it('is no chain on the GM tier while the GM tier bypass is on', () => {
    expect(resolveEffects(guitar(), GM_ON)).toEqual({ preset: undefined, automatic: true });
    expect(resolveEffects(guitar({ preset: 'from-the-future' }), GM_ON)).toEqual({
      preset: undefined,
      automatic: true,
    });
    expect(resolveEffects(guitar({ packId: 'p' }), GM_ON).preset).toBeUndefined();
  });

  it('is the family on the GM tier once the bypass is off', () => {
    expect(resolveEffects(guitar(), GM_OFF)).toEqual({ preset: 'distortion', automatic: true });
    expect(resolveEffects({ kind: 'drums', program: 0 }, GM_OFF).preset).toBe('drums');
  });
});

describe('stagesOf', () => {
  it('is the preset less the bypassed stages, and nothing for no preset', () => {
    expect(stagesOf(undefined)).toEqual({});
    expect(stagesOf('distortion', new Set(['cabinet', 'reverb']))).toEqual({
      ...EFFECT_PRESETS.distortion,
      cabinet: undefined,
      reverb: undefined,
    });
    expect(Object.keys(stagesOf('distortion', new Set(EFFECT_STAGES)))).toEqual([]);
  });
});
