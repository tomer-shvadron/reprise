import { describe, expect, it } from 'vitest';

import { evaluateModulators } from '../sampler/region-map';
import type { ModulatorSource, NoteModulator } from '../sampler/region-map';
import { Gen } from './generators';
import { layerModulators, mergeModulators } from './modulators';
import type { Sf2Modulator } from './parse';

const NO_SOURCE: ModulatorSource = {
  input: 'none',
  curve: 'linear',
  negative: false,
  bipolar: false,
};

function velocityModulator(
  curve: ModulatorSource['curve'],
  negative: boolean,
  bipolar: boolean,
  amount = 1000,
): NoteModulator[] {
  return [
    {
      destination: 'filterFc',
      amount,
      source: { input: 'velocity', curve, negative, bipolar },
      amountSource: NO_SOURCE,
      absolute: false,
    },
  ];
}

function filterCents(modulators: readonly NoteModulator[], key: number, velocity: number): number {
  return evaluateModulators(modulators, key, velocity).filterCents;
}

describe('modulator curves (SF2 2.04 8.2.1)', () => {
  it('shapes a positive unipolar source at 0, 64 and 127', () => {
    const at = (curve: ModulatorSource['curve'], v: number) =>
      filterCents(velocityModulator(curve, false, false), 60, v);
    expect(at('linear', 0)).toBe(0);
    expect(at('linear', 64)).toBeCloseTo((1000 * 64) / 127, 9);
    expect(at('linear', 127)).toBe(1000);
    expect(at('concave', 0)).toBe(0);
    expect(at('concave', 127)).toBe(1000);
    expect(at('concave', 64)).toBeCloseTo(1000 * -(40 / 96) * Math.log10(1 - 64 / 127), 9);
    expect(at('convex', 0)).toBe(0);
    expect(at('convex', 127)).toBe(1000);
    expect(at('convex', 64)).toBeCloseTo(1000 * (1 + (40 / 96) * Math.log10(64 / 127)), 9);
    expect(at('switch', 0)).toBe(0);
    expect(at('switch', 63)).toBe(0);
    expect(at('switch', 64)).toBe(1000);
    expect(at('switch', 127)).toBe(1000);
  });

  it('turns a negative source around and a bipolar one into -1..1', () => {
    const negative = (v: number) => filterCents(velocityModulator('linear', true, false), 60, v);
    expect(negative(0)).toBe(1000);
    expect(negative(127)).toBe(0);
    expect(negative(64)).toBeCloseTo(1000 * (1 - 64 / 127), 9);
    const bipolar = (v: number) => filterCents(velocityModulator('linear', false, true), 60, v);
    expect(bipolar(0)).toBe(-1000);
    expect(bipolar(127)).toBe(1000);
    expect(bipolar(64)).toBeCloseTo(1000 * (2 * (64 / 127) - 1), 9);
    const both = (v: number) => filterCents(velocityModulator('switch', true, true), 60, v);
    expect(both(0)).toBe(1000);
    expect(both(127)).toBe(-1000);
  });

  it('reads the key and multiplies the amount source, with an absolute transform', () => {
    const keyed: NoteModulator[] = [
      {
        destination: 'modEnvToFilterFc',
        amount: -1200,
        source: { input: 'key', curve: 'linear', negative: false, bipolar: false },
        amountSource: { input: 'velocity', curve: 'switch', negative: false, bipolar: false },
        absolute: true,
      },
    ];
    expect(evaluateModulators(keyed, 127, 127).modEnvCents).toBe(1200);
    expect(evaluateModulators(keyed, 0, 127).modEnvCents).toBe(0);
    expect(evaluateModulators(keyed, 127, 10).modEnvCents).toBe(0);
  });

  it('sums attenuation and Q in dB from centibels', () => {
    const mods: NoteModulator[] = [
      {
        destination: 'attenuation',
        amount: 100,
        source: NO_SOURCE,
        amountSource: NO_SOURCE,
        absolute: false,
      },
      {
        destination: 'filterQ',
        amount: 60,
        source: NO_SOURCE,
        amountSource: NO_SOURCE,
        absolute: false,
      },
    ];
    expect(evaluateModulators(mods, 60, 100)).toEqual({
      attenuationDb: 10,
      filterCents: 0,
      modEnvCents: 0,
      filterQDb: 6,
    });
  });
});

const VELOCITY_ATTENUATION: Sf2Modulator = {
  source: 0x0502,
  destination: Gen.initialAttenuation,
  amount: 960,
  amountSource: 0,
  transform: 0,
};

describe('merging modulators (SF2 2.04 9.5)', () => {
  it('has the default velocity curve equal to (v / 127)^2 exactly', () => {
    const { modulators, unapplied } = mergeModulators([], []);
    expect(unapplied).toBe(0);
    for (const v of [1, 20, 64, 100, 127]) {
      const dB = evaluateModulators(modulators, 60, v).attenuationDb;
      expect(10 ** (-dB / 20)).toBeCloseTo((v / 127) ** 2, 12);
    }
  });

  it('moves no cutoff by default: the velocity to cutoff default is inert, as in FluidSynth', () => {
    const { modulators } = mergeModulators([], []);
    for (const v of [1, 63, 64, 95, 127]) {
      expect(evaluateModulators(modulators, 60, v).filterCents).toBe(0);
    }
    // Even a zone that states it, with the default's identity, contributes nothing and is not unapplied.
    const stated: Sf2Modulator = {
      source: 0x0102,
      destination: Gen.initialFilterFc,
      amount: -2400,
      amountSource: 0x0c02,
      transform: 0,
    };
    const merged = mergeModulators([stated], []);
    expect(merged.unapplied).toBe(0);
    expect(merged.modulators.some((m) => m.destination === 'filterFc')).toBe(false);
    // GeneralUser GS's own velocity to cutoff modulators have another identity and apply.
    const own = mergeModulators([{ ...stated, amountSource: 0 }], []);
    expect(evaluateModulators(own.modulators, 60, 64).filterCents).toBeCloseTo(
      -2400 * (1 - 64 / 127),
      9,
    );
  });

  it('mirrors a bipolar concave source over its two halves, an S shape', () => {
    const at = (v: number) => filterCents(velocityModulator('concave', false, true), 60, v);
    expect(at(0)).toBeCloseTo(-1000, 9);
    expect(at(127)).toBeCloseTo(1000, 9);
    // Symmetric about the middle, unlike one concave curve stretched over -1..1.
    expect(at(32) + at(95)).toBeCloseTo(0, 9);
    expect(at(95)).toBeGreaterThan(0);
  });

  it('replaces a default with an instrument modulator of the same identity', () => {
    const softer = { ...VELOCITY_ATTENUATION, amount: 700 };
    const { modulators } = mergeModulators([softer], []);
    const attenuation = modulators.filter((m) => m.destination === 'attenuation');
    expect(attenuation).toHaveLength(1);
    expect(attenuation[0]?.amount).toBe(700);
    const off = mergeModulators([{ ...VELOCITY_ATTENUATION, amount: 0 }], []).modulators;
    expect(off.some((m) => m.destination === 'attenuation')).toBe(false);
  });

  it('adds a preset modulator to the identical one and appends one it has no match for', () => {
    const instrument = { ...VELOCITY_ATTENUATION, amount: 700 };
    const added = mergeModulators([instrument], [{ ...VELOCITY_ATTENUATION, amount: 100 }]);
    expect(added.modulators.find((m) => m.destination === 'attenuation')?.amount).toBe(800);
    const extra: Sf2Modulator = {
      source: 0x0003, // key, linear
      destination: Gen.initialFilterFc,
      amount: 100,
      amountSource: 0,
      transform: 0,
    };
    const appended = mergeModulators([], [extra]);
    expect(appended.modulators.filter((m) => m.destination === 'filterFc')).toHaveLength(1);
  });

  it('lets a later modulator at one level replace an earlier one, so a local zone wins over its global', () => {
    const layered = layerModulators(
      [{ ...VELOCITY_ATTENUATION, amount: 500 }],
      [{ ...VELOCITY_ATTENUATION, amount: 800 }],
    );
    expect(layered).toHaveLength(1);
    expect(layered[0]?.amount).toBe(800);
  });

  it('skips and counts controller, pressure and linked sources and other destinations', () => {
    const cc91: Sf2Modulator = {
      source: 0x80 | 91,
      destination: Gen.reverbEffectsSend,
      amount: 200,
      amountSource: 0,
      transform: 0,
    };
    const pressure: Sf2Modulator = {
      source: 13,
      destination: Gen.initialAttenuation,
      amount: 50,
      amountSource: 0,
      transform: 0,
    };
    const linked: Sf2Modulator = {
      source: 0x0502,
      destination: 0x8000 | 5,
      amount: 50,
      amountSource: 0,
      transform: 0,
    };
    const pitch: Sf2Modulator = {
      source: 0x0502,
      destination: Gen.coarseTune,
      amount: 5,
      amountSource: 0,
      transform: 0,
    };
    const { modulators, unapplied } = mergeModulators([cc91, pressure, linked, pitch], []);
    expect(unapplied).toBe(4);
    expect(modulators.map((m) => m.destination)).toEqual(['attenuation']);
  });
});
