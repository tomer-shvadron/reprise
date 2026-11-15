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

describe('RegionMap selection', () => {
  const kit = new RegionMap([
    region({ sample: 'attack' }),
    region({ sample: 'release', trigger: 'release' }),
    region({ sample: 'first', trigger: 'first' }),
    region({ sample: 'legato', trigger: 'legato' }),
    region({ sample: 'rr1', sequence: { length: 3, position: 1 } }),
    region({ sample: 'rr2', sequence: { length: 3, position: 2 } }),
    region({ sample: 'rr3', sequence: { length: 3, position: 3 } }),
    region({ sample: 'lowdraw', random: { lo: 0, hi: 0.5 } }),
    region({ sample: 'highdraw', random: { lo: 0.5, hi: 1 } }),
  ]);
  const names = (regions: { sample: string }[]) => regions.map((r) => r.sample);

  it('defaults to the first take: position 1, the bucket holding 0, no legato, no release', () => {
    expect(names(kit.resolveAll(60, 100))).toEqual(['attack', 'first', 'rr1', 'lowdraw']);
  });

  it('follows the counters it is given', () => {
    expect(names(kit.resolveAll(60, 100, undefined, { sequence: 4, random: 0.5 }))).toEqual([
      'attack',
      'first',
      'rr2',
      'highdraw',
    ]);
    expect(names(kit.resolveAll(60, 100, undefined, { sequence: 2, random: 0.49 }))).toContain(
      'rr3',
    );
  });

  it('swaps first for legato when the note starts over a sounding one', () => {
    const legato = names(kit.resolveAll(60, 100, undefined, { legato: true }));
    expect(legato).toContain('legato');
    expect(legato).not.toContain('first');
    expect(legato).toContain('attack');
  });

  it('keeps the nearest-region fallback inside the regions that pass', () => {
    const map = new RegionMap([
      region({ keyLo: 60, keyHi: 60, sample: 'tail', trigger: 'release' }),
      region({ keyLo: 70, keyHi: 70, sample: 'far' }),
    ]);
    expect(names(map.resolveAll(60, 100))).toEqual(['far']);
  });

  it('lists every region a note could start in candidates, release excluded', () => {
    expect(names(kit.candidates(60, 100)).sort()).toEqual(
      ['attack', 'first', 'legato', 'rr1', 'rr2', 'rr3', 'lowdraw', 'highdraw'].sort(),
    );
    const sf2 = new RegionMap([region({ sample: 'a' }), region({ sample: 'b' })]);
    expect(sf2.candidates(60, 100)).toEqual(sf2.resolveAll(60, 100));
  });

  it('unites the fallback over every selection', () => {
    const robin = new RegionMap([
      region({ keyLo: 70, keyHi: 70, sample: 'rr1', sequence: { length: 2, position: 1 } }),
      region({ keyLo: 70, keyHi: 70, sample: 'rr2', sequence: { length: 2, position: 2 } }),
    ]);
    expect(names(robin.resolveAll(60, 100, undefined, { sequence: 1 }))).toEqual(['rr2']);
    expect(names(robin.candidates(60, 100)).sort()).toEqual(['rr1', 'rr2']);
  });
});
