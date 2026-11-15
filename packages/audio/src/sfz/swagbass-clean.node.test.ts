import { describe, expect, it } from 'vitest';

import text from '../../test-fixtures/sfz/karoryfer-swagbass/swagbass_clean.sfz?raw';
import { RegionMap } from '../sampler/region-map';
import { loadSfz } from './load';
import { isClean } from './report';
import { memoryReader } from './test-reader';

describe('Karoryfer Swagbass (CC0), SFZ text only', () => {
  it('loads cleanly into 254 regions, one per sample file, and pins what it counts', async () => {
    const { regions, layers, report } = await loadSfz(
      'swagbass_clean.sfz',
      memoryReader({ 'swagbass_clean.sfz': text }),
      { packId: 'swagbass' },
    );
    expect(isClean(report)).toBe(true);
    expect(report.regions).toBe(254);
    expect(regions).toHaveLength(254);
    expect(new Set(regions.map((r) => r.sample)).size).toBe(254);
    expect(regions.every((r) => r.sample.startsWith('sfz:swagbass/'))).toBe(true);
    expect(regions.some((r) => r.sample.includes('\\'))).toBe(false);
    expect(layers).toEqual([]);
    expect(report.dropped).toEqual({});
    expect(report.unknown).toEqual({});
    expect(report.notes).toEqual([]);
    expect(report.unsupported).toEqual({
      amp_velcurve_110: 17,
      amp_velcurve_50: 17,
      bend_down: 61,
      bend_up: 61,
    });
    // Round robins and velocity layers resolve to a note, not to silence.
    const map = new RegionMap(regions);
    expect(map.candidates(60, 100).length).toBeGreaterThan(0);
  });
});
