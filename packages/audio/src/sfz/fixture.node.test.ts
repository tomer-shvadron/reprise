import { describe, expect, it } from 'vitest';

import common from '../../test-fixtures/sfz/common.sfzh?raw';
import synthetic from '../../test-fixtures/sfz/synthetic.sfz?raw';
import { RegionMap } from '../sampler/region-map';
import { loadSfz } from './load';
import { OPCODES, lookupOpcode } from './opcodes';
import { isClean } from './report';
import { memoryReader } from './test-reader';

const load = () =>
  loadSfz('synthetic.sfz', memoryReader({ 'synthetic.sfz': synthetic, 'common.sfzh': common }), {
    packId: 'synthetic',
  });

describe('the synthetic fixture', () => {
  it('uses every opcode and alias in the table, so the table cannot outgrow it', async () => {
    const { report } = await load();
    const missing = OPCODES.flatMap((spec) => [spec.name, ...(spec.aliases ?? [])]).filter(
      (spelling) => !(spelling in report.used),
    );
    expect(missing).toEqual([]);
  });

  it('parses cleanly', async () => {
    const { report } = await load();
    expect(isClean(report)).toBe(true);
    expect(report.unresolvedIncludes).toEqual([]);
    expect(report.notes).toEqual([]);
    expect(report.dropped).toEqual({ generator: 1, disabledKey: 1 });
    expect(report.ignoredHeaders).toEqual({ curve: 1, effect: 1 });
    expect(report.unknown).toEqual(
      { vendor_extension: 1, curve_index: 0 }.vendor_extension ? { vendor_extension: 1 } : {},
    );
    expect(Object.keys(report.unsupported).sort()).toEqual(
      [
        'amp_velcurve_64',
        'cutoff',
        'fileg_attack',
        'fil_type',
        'lfo01_freq',
        'off_mode',
        'polyphony',
        'resonance',
        'rt_decay',
        'volume_oncc7',
      ].sort(),
    );
    for (const name of Object.keys(report.unsupported)) {
      expect(lookupOpcode(name).type).toBe('unsupported');
    }
  });

  it('maps onto regions a RegionMap accepts, with the include and defines applied', async () => {
    const { regions, layers, keyswitchRange } = await load();
    const map = new RegionMap(regions);
    const piano = map.resolveAll(55, 30);
    expect(piano.map((r) => r.sample)).toContain('sfz:synthetic/samples/piano soft C3.wav');
    // $KICK comes from common.sfzh; the master's -1 dB reaches it, the included group is reset.
    expect(regions.find((r) => r.sample.endsWith('kick.wav'))).toMatchObject({
      keyLo: 36,
      attenuation: 1,
    });
    expect(layers.map((l) => l.id)).toEqual(['sw:24', 'sw:25', 'sw:26']);
    expect(keyswitchRange).toEqual({ lo: 24, hi: 26 });
    expect(map.layers).toEqual(['sw:24', 'sw:25', 'sw:26']);
    // The default layer plays the sw_default articulation.
    expect(map.resolveAll(60, 100).map((r) => r.sample)).toContain(
      'sfz:synthetic/samples/ks sustain.wav',
    );
  });
});
