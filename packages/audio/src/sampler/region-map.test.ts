import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import { region } from './test/offline';

const map = new RegionMap([
  region({ keyLo: 40, keyHi: 59, velLo: 1, velHi: 63, sample: 'low-soft' }),
  region({ keyLo: 40, keyHi: 59, velLo: 64, velHi: 127, sample: 'low-loud' }),
  region({ keyLo: 60, keyHi: 84, velLo: 1, velHi: 127, sample: 'high' }),
  region({ keyLo: 40, keyHi: 84, velLo: 1, velHi: 127, sample: 'muted', layer: 'palmMute' }),
]);

describe('RegionMap', () => {
  it('selects by key and velocity', () => {
    expect(map.resolve(45, 30)?.sample).toBe('low-soft');
    expect(map.resolve(45, 63)?.sample).toBe('low-soft');
    expect(map.resolve(45, 64)?.sample).toBe('low-loud');
    expect(map.resolve(59, 127)?.sample).toBe('low-loud');
    expect(map.resolve(60, 10)?.sample).toBe('high');
  });

  it('selects by layer and falls back to the default layer', () => {
    expect(map.resolve(45, 100, 'palmMute')?.sample).toBe('muted');
    expect(map.resolve(45, 100, 'harmonic')?.sample).toBe('low-loud');
    expect(map.layers).toEqual(['palmMute']);
  });

  it('falls back to the nearest region outside the mapped range', () => {
    expect(map.resolve(35, 100)?.sample).toBe('low-loud');
    expect(map.resolve(100, 10)?.sample).toBe('high');
    expect(new RegionMap([region({ velLo: 100, velHi: 127 })]).resolve(60, 20)?.velLo).toBe(100);
  });

  it('uses the only layer when no default layer exists', () => {
    const layered = new RegionMap([region({ layer: 'sustain', sample: 'sustain' })]);
    expect(layered.resolve(60, 100)?.sample).toBe('sustain');
  });

  it('resolves nothing from an empty map and rejects bad ranges', () => {
    expect(new RegionMap([]).resolve(60, 100)).toBeUndefined();
    expect(() => new RegionMap([region({ keyLo: 70, keyHi: 60 })])).toThrow(RangeError);
    expect(() => new RegionMap([region({ velHi: 128 })])).toThrow(RangeError);
  });
});
