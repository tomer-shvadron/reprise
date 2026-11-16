import { describe, expect, it } from 'vitest';

import { SfzPack } from '../sfz/pack';
import { syntheticSfzPack } from '../testing/synthetic-pack';
import {
  ProviderRouter,
  packInstrumentId,
  packInstrumentsOf,
  parsePackInstrumentId,
} from './provider-router';
import type { SampleProvider } from './types';

const gm: SampleProvider = {
  instrumentsOf: (ref) => (ref.startsWith('gm:') ? ['gm:0:0'] : []),
  byteLength: () => 8,
  fetch: () =>
    Promise.resolve({ sampleRate: 8000, channels: [new Float32Array(2)], byteLength: 8 }),
};

describe('ProviderRouter', () => {
  async function routed() {
    const files = syntheticSfzPack();
    const pack = new SfzPack({ id: 'packone00001@1', files: files.files });
    await pack.loadInstrument('default.sfz', {
      id: packInstrumentId('packone00001@1', 'default.sfz'),
    });
    const router = new ProviderRouter(gm);
    router.setPacks(new Map([['packone00001@1', pack]]));
    return { router, files };
  }

  it('sends a pack ref to its pack and anything else to the soundfont', async () => {
    const { router, files } = await routed();
    const ref = 'sfz:packone00001@1/samples/a.wav';
    expect(router.instrumentsOf(ref)).toEqual(['sfz:packone00001@1:default.sfz']);
    expect(router.instrumentsOf('gm:0:0/sample')).toEqual(['gm:0:0']);
    expect(router.byteLength('gm:0:0/sample')).toBe(8);
    expect(Number.isFinite(router.byteLength(ref))).toBe(true);
    const sample = await router.fetch(ref);
    expect(sample.channels[0]?.length).toBeGreaterThan(0);
    expect(files.reads.get('samples/a.wav')).toBe(1);
    await expect(router.fetch('gm:0:0/sample')).resolves.toMatchObject({ sampleRate: 8000 });
  });

  it('rejects a ref of a pack it does not hold, and gives it no owners', async () => {
    const { router } = await routed();
    const ref = 'sfz:otherpack001/samples/a.wav';
    expect(router.instrumentsOf(ref)).toEqual([]);
    expect(router.byteLength(ref)).toBeNaN();
    await expect(router.fetch(ref)).rejects.toThrow('belongs to no installed pack');
    await expect(router.fetch('sfz:malformed')).rejects.toThrow('belongs to no installed pack');
  });

  it('stops serving a pack once it is left out', async () => {
    const { router } = await routed();
    router.setPacks(new Map());
    await expect(router.fetch('sfz:packone00001@1/samples/a.wav')).rejects.toThrow();
  });
});

describe('pack instrument ids', () => {
  it('round-trips, and names a pack’s instruments among the residents', () => {
    const id = packInstrumentId('packone00001@7', 'kits/a b.sfz');
    expect(parsePackInstrumentId(id)).toEqual({
      packId: 'packone00001',
      install: '7',
      path: 'kits/a b.sfz',
    });
    expect(parsePackInstrumentId('gm:0:25')).toBeUndefined();
    expect(parsePackInstrumentId('sfz:nocolon')).toBeUndefined();
    const residents = ['gm:0:25', id, packInstrumentId('packtwo00001@8', 'x.sfz')];
    expect(packInstrumentsOf(residents, 'packone00001')).toEqual(['kits/a b.sfz']);
  });
});
