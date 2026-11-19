import { describe, expect, it } from 'vitest';

import { MAX_DECAY_TIMECENTS, MAX_HOLD_TIMECENTS, RegionMap, keyScaledTime } from './region-map';
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

  it('lists every region a note could start or release in candidates', () => {
    expect(names(kit.candidates(60, 100)).sort()).toEqual(
      ['attack', 'release', 'first', 'legato', 'rr1', 'rr2', 'rr3', 'lowdraw', 'highdraw'].sort(),
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

describe('RegionMap.resolveRelease', () => {
  const tails = new RegionMap([
    region({ sample: 'attack' }),
    region({ keyLo: 40, keyHi: 59, sample: 'low-tail', trigger: 'release' }),
    region({
      keyLo: 60,
      keyHi: 84,
      sample: 'tail-a',
      trigger: 'release',
      random: { lo: 0, hi: 0.5 },
    }),
    region({
      keyLo: 60,
      keyHi: 84,
      sample: 'tail-b',
      trigger: 'release',
      random: { lo: 0.5, hi: 1 },
    }),
    region({ sample: 'muted-tail', trigger: 'release', layer: 'palmMute' }),
    region({ sample: 'muted', layer: 'palmMute' }),
  ]);
  const names = (regions: { sample: string }[]) => regions.map((r) => r.sample);

  it('returns the release regions of the key, and only those', () => {
    expect(names(tails.resolveRelease(45, 100))).toEqual(['low-tail']);
    expect(names(tails.resolveRelease(70, 100))).toEqual(['tail-a']);
  });

  it('applies the counters the note was chosen by', () => {
    expect(names(tails.resolveRelease(70, 100, undefined, { random: 0.7 }))).toEqual(['tail-b']);
  });

  it('follows the layer, falling back to the default layer', () => {
    expect(names(tails.resolveRelease(70, 100, 'palmMute'))).toEqual(['muted-tail']);
    expect(names(tails.resolveRelease(70, 100, 'harmonic'))).toEqual(['tail-a']);
  });

  it('matches key and velocity exactly: a note-off outside every release region is silent', () => {
    expect(tails.resolveRelease(100, 100)).toEqual([]);
    expect(tails.candidates(100, 100).map((r) => r.sample)).toEqual(['attack']);
    const loud = new RegionMap([
      region({ sample: 'a' }),
      region({ sample: 'noise', trigger: 'release', velLo: 100, velHi: 127 }),
    ]);
    expect(names(loud.resolveRelease(60, 110))).toEqual(['noise']);
    expect(loud.resolveRelease(60, 40)).toEqual([]);
  });

  it('flags a map with release regions, and returns nothing from one with none', () => {
    expect(tails.hasReleaseRegions).toBe(true);
    const plain = new RegionMap([region({ sample: 'a' })]);
    expect(plain.hasReleaseRegions).toBe(false);
    expect(plain.resolveRelease(60, 100)).toEqual([]);
  });

  it('keeps release regions out of resolveAll and includes both draws in candidates', () => {
    expect(names(tails.resolveAll(70, 100))).toEqual(['attack']);
    expect(names(tails.candidates(70, 100)).sort()).toEqual(['attack', 'tail-a', 'tail-b']);
  });
});

describe('keyScaledTime', () => {
  it('caps the key-scaled decay at 8000 timecents, as FluidSynth does', () => {
    // 6000 tc at key 60 plus 50 tc per key over 60 keys is 9000 tc, about 181 s unclamped.
    const decay = keyScaledTime(2 ** (6000 / 1200), 50, 0, MAX_DECAY_TIMECENTS);
    expect(decay).toBeCloseTo(2 ** (8000 / 1200), 9);
    expect(decay).toBeLessThan(102);
  });

  it('caps the key-scaled hold at 5000 timecents', () => {
    expect(keyScaledTime(2 ** (4000 / 1200), 40, 0, MAX_HOLD_TIMECENTS)).toBeCloseTo(
      2 ** (5000 / 1200),
      9,
    );
  });

  it('floors the sum at -12000 timecents and leaves an in-range sum alone', () => {
    expect(keyScaledTime(2 ** (-11000 / 1200), 100, 120, MAX_DECAY_TIMECENTS)).toBeCloseTo(
      2 ** (-12000 / 1200),
      9,
    );
    expect(keyScaledTime(1, 50, 48, MAX_DECAY_TIMECENTS)).toBeCloseTo(2 ** (600 / 1200), 9);
  });

  it('clamps the unscaled sum when the stored time carries a factor', () => {
    // 6000 tc + 50 tc/key at key 0 is 9000 tc; the stored time already has a 0.2 factor.
    expect(keyScaledTime(2 ** (6000 / 1200) * 0.2, 50, 0, MAX_DECAY_TIMECENTS, 0.2)).toBeCloseTo(
      2 ** (8000 / 1200) * 0.2,
      9,
    );
  });

  it('skips the clamp without a per-key factor', () => {
    expect(keyScaledTime(2 ** (9000 / 1200), undefined, 0, MAX_DECAY_TIMECENTS)).toBeCloseTo(
      2 ** (9000 / 1200),
      9,
    );
  });
});
