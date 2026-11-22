import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { RegionMap } from '../sampler/region-map';
import { loadSfz } from '../sfz/load';
import { planInstruments, planSamples } from '../samples/plan';
import { GUITAR_NOISES, GUITAR_TONES, syntheticGuitarPack } from '../testing/synthetic-guitar-pack';
import type { PlanVoicing } from './sets';
import { availableSets, setsOfLayers, voicingOf } from './sets';

/** The reference electric guitar, read the way the engine reads a pack: its labelled keyswitch layers. */
async function reference() {
  const pack = syntheticGuitarPack({ articulations: true });
  const parsed = await loadSfz('default.sfz', pack.files.read.bind(pack.files), {
    packId: 'guitar',
  });
  const sets = setsOfLayers(parsed.layers);
  return { regions: new RegionMap(parsed.regions), sets, available: availableSets(sets) };
}

const hertzOf = (sample: string | undefined): string => (sample ?? '').split('/').pop() ?? '';

describe('the reference guitar pack and the articulation sets', () => {
  it('finds a layer for every set the synthetic guitar labels', async () => {
    const { sets } = await reference();
    expect([...Object.keys(sets)].sort()).toEqual([
      'dead',
      'harmonic',
      'legato',
      'palmMute',
      'staccato',
    ]);
  });

  it('plays the palm-mute layer for a palm-muted beat, and the sustain layer for a plain one', async () => {
    const { regions, sets, available } = await reference();
    const muted = voicingOf(
      { kind: 'fretted', note: note(1, 12, { palmMute: true }), effects: {} },
      available,
    );
    expect(muted.set).toBe('palmMute');
    const layer = sets[muted.set]?.layer;
    expect(layer).toBe('sw:25');
    expect(regions.resolveAll(69, 100, layer).map((region) => hertzOf(region.sample))).toEqual([
      'palmMute.wav',
    ]);

    const plain = voicingOf({ kind: 'fretted', note: note(1, 12), effects: {} }, available);
    expect(plain.set).toBe('default');
    expect(regions.resolveAll(69, 100).map((region) => hertzOf(region.sample))).toEqual([
      'default.wav',
    ]);
    expect(GUITAR_TONES.palmMute).not.toBe(GUITAR_TONES.default);
  });

  it('plans the layer the song uses and no other keyswitch layer', async () => {
    const { regions, sets } = await reference();
    const planned: PlanVoicing = Object.fromEntries(
      Object.entries(sets).map(([set, found]) => [set, { layer: found.layer }]),
    );
    const track = { tuning: [57] };
    const muted = score()
      .track('guitar', track)
      .bar()
      .beat('1', [note(1, 12, { palmMute: true })])
      .build();
    const plain = score()
      .track('guitar', track)
      .bar()
      .beat('1', [note(1, 12)])
      .build();
    const refsOf = (song: typeof muted): string[] =>
      planSamples(
        planInstruments(song, { instrumentOf: () => 'guitar', voicingFor: () => planned }),
        () => regions,
      )
        .map(hertzOf)
        .sort();
    expect(refsOf(muted)).toEqual(['palmMute.wav', 'release.wav']);
    expect(refsOf(plain)).toEqual(['default.wav', 'release.wav']);
  });
});

describe('noise keys in the plan', () => {
  async function noisy() {
    const pack = syntheticGuitarPack({ noises: true });
    const parsed = await loadSfz('default.sfz', pack.files.read.bind(pack.files), {
      packId: 'guitar',
    });
    const regions = new RegionMap(parsed.regions);
    const planned: PlanVoicing = { dead: { keys: [100, 101, 102, 103] } };
    return { regions, planned };
  }
  const track = { tuning: [40, 45, 50, 55] };
  const song = (...frets: [number, boolean][]) => {
    let bar = score().track('guitar', track).bar();
    for (const [string, dead] of frets) bar = bar.beat('4', [note(string, 5, { dead })]);
    return bar.build();
  };

  it('plans the key of each dead note string, and not its pitch or the sustain', async () => {
    const { regions, planned } = await noisy();
    const plan = planInstruments(song([4, true], [1, true]), {
      instrumentOf: () => 'guitar',
      voicingFor: () => planned,
    });
    expect(plan.tracks[0]?.uses[0]?.keys).toEqual([100, 103]);
    const refs = planSamples(plan, () => regions)
      .map(hertzOf)
      .sort();
    const noises = GUITAR_NOISES.tones;
    const expected = [...noises[0], ...noises[3]].map((hertz) => `noise${String(hertz)}.wav`);
    expect(refs).toEqual([...expected, 'release.wav'].sort());
  });

  it('plans no noise for a song without dead notes', async () => {
    const { planned } = await noisy();
    const plan = planInstruments(song([4, false]), {
      instrumentOf: () => 'guitar',
      voicingFor: () => planned,
    });
    expect(plan.tracks[0]?.uses[0]?.keys).toEqual([45]);
  });
});
