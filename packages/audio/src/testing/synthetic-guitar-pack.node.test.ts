import { describe, expect, it } from 'vitest';

import { articulationSetOf } from '../articulations/sets';
import { loadSfz } from '../sfz/load';
import { isClean } from '../sfz/report';
import { RegionMap } from '../sampler/region-map';
import {
  GUITAR_RELEASE_DECAY,
  GUITAR_ROOT_KEY,
  GUITAR_SELECTION,
  GUITAR_TONES,
  syntheticGuitarPack,
} from './synthetic-guitar-pack';

async function load() {
  const pack = syntheticGuitarPack();
  const parsed = await loadSfz('default.sfz', pack.files.read.bind(pack.files), {
    packId: 'guitar',
  });
  return { pack, ...parsed };
}

describe('syntheticGuitarPack', () => {
  it('parses cleanly into a default layer and a labelled keyswitch layer per articulation', async () => {
    const { pack, report, layers } = await load();
    expect(isClean(report)).toBe(true);
    expect(report.unsupported).toEqual({});
    expect(pack.entries).toEqual({ default: 'default.sfz' });
    expect(layers.map((layer) => [layer.id, articulationSetOf(layer.label ?? '')])).toEqual([
      ['sw:24', 'default'],
      ['sw:25', 'palmMute'],
      ['sw:26', 'harmonic'],
      ['sw:27', 'legato'],
    ]);
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining(Object.values(pack.layers)),
    );
  });

  it('gives each layer a sample of its own, and keeps the default layer to the sustain', async () => {
    const { regions } = await load();
    const map = new RegionMap(regions);
    const sample = (layer?: string) =>
      map.resolveAll(GUITAR_ROOT_KEY, 100, layer).map((r) => r.sample.split('/').pop());
    expect(sample()).toEqual(['default.wav']);
    expect(sample('sw:25')).toEqual(['palmMute.wav']);
    expect(sample('sw:26')).toEqual(['harmonic.wav']);
    expect(sample('sw:27')).toEqual(['legato.wav']);
    expect(new Set(Object.values(GUITAR_TONES)).size).toBe(Object.keys(GUITAR_TONES).length);
  });

  it('has release samples in every layer, a one-shot with rt_decay, outside what a note starts', async () => {
    const { regions } = await load();
    const map = new RegionMap(regions);
    for (const layer of [undefined, 'sw:25', 'sw:26', 'sw:27']) {
      const released = map.resolveRelease(GUITAR_ROOT_KEY, 100, layer);
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({
        trigger: 'release',
        oneShot: true,
        releaseDecay: GUITAR_RELEASE_DECAY,
      });
      expect(map.resolveAll(GUITAR_ROOT_KEY, 100, layer).map((r) => r.trigger)).toEqual([
        undefined,
      ]);
      expect(map.candidates(GUITAR_ROOT_KEY, 100, layer).map((r) => r.trigger)).toContain(
        'release',
      );
    }
  });

  it('reads only what it serves, and reports a missing file', async () => {
    const pack = syntheticGuitarPack();
    expect([...pack.contents.keys()].sort()).toEqual([
      'default.sfz',
      'samples/default.wav',
      'samples/harmonic.wav',
      'samples/legato.wav',
      'samples/palmMute.wav',
      'samples/release.wav',
    ]);
    await expect(pack.files.read('missing.wav')).rejects.toThrow('No file missing.wav');
    expect(pack.reads.get('missing.wav')).toBe(1);
  });

  it('adds the velocity, round-robin and legato regions only when asked, outside the layers', async () => {
    const plain = await load();
    const pack = syntheticGuitarPack({ selection: true });
    const { regions, report } = await loadSfz('default.sfz', pack.files.read.bind(pack.files), {
      packId: 'guitar',
    });
    expect(isClean(report)).toBe(true);
    expect(report.unsupported).toEqual({});
    const map = new RegionMap(regions);
    const { velocity, sequence, random, legato } = GUITAR_SELECTION;
    expect(map.resolveAll(velocity.key, 10).map((r) => r.sample)).toHaveLength(1);
    expect(map.candidates(sequence.key, 100).filter((r) => !r.trigger)).toHaveLength(3);
    expect(map.candidates(random.key, 100).filter((r) => !r.trigger)).toHaveLength(3);
    expect(map.resolveAll(legato.key, 100, undefined, { legato: true })[0]?.trigger).toBe('legato');
    expect(map.resolveRelease(sequence.key, 100)).toHaveLength(1);
    // Nothing a pack without them plays moves: the same regions at the layers' own keys.
    const base = new RegionMap(plain.regions);
    const sample = (m: RegionMap) =>
      m.resolveAll(GUITAR_ROOT_KEY, 100, 'sw:25').map((r) => r.sample);
    expect(sample(map)).toEqual(sample(base));
    expect(plain.pack.entries).toEqual(pack.entries);
    expect(pack.layers).toEqual(plain.pack.layers);
  });
});
