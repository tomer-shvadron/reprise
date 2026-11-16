import { describe, expect, it } from 'vitest';

import common from '../../test-fixtures/sfz/common.sfzh?raw';
import synthetic from '../../test-fixtures/sfz/synthetic.sfz?raw';
import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { offline, rms, toneLevel } from '../sampler/test/offline';
import { ManagedSampleSource } from '../samples/managed-sample-source';
import { SfzPack } from './pack';
import { encodeWav, sine } from './test/encode';

const TRACK: SamplerTrack = {
  id: 't',
  kind: 'pitched',
  tuning: [],
  capo: 0,
  channel: {
    volume: 127,
    pan: 64,
    chorus: 0,
    reverb: 0,
    phaser: 0,
    tremolo: 0,
    mute: false,
    solo: false,
  },
};

const RATE = 22_050;
/** Samples the fixture plays at a pitch a test measures, or for longer than a note. */
const SPECS: Readonly<Record<string, { frequency: number; seconds: number }>> = {
  'ks sustain.wav': { frequency: 200, seconds: 0.5 },
  'ks mute.wav': { frequency: 300, seconds: 0.5 },
  'ride.wav': { frequency: 440, seconds: 1 },
};
const DEFAULT = { frequency: 250, seconds: 0.25 };

const frames = (name: string): number => Math.round((SPECS[name] ?? DEFAULT).seconds * RATE);

/** The fixture's SFZ text, and a WAV generated for any sample it names the first time it is read. */
function packOf() {
  const reads: string[] = [];
  const texts: Record<string, string> = { 'synthetic.sfz': synthetic, 'common.sfzh': common };
  const pack = new SfzPack({
    id: 'synthetic',
    files: {
      read: (path) => {
        reads.push(path);
        const text = texts[path];
        if (text !== undefined) return Promise.resolve(new TextEncoder().encode(text));
        const name = /^samples\/(.+\.wav)$/.exec(path)?.[1];
        if (name === undefined) return Promise.reject(new Error(`No file ${path}`));
        const spec = SPECS[name] ?? DEFAULT;
        return Promise.resolve(encodeWav([sine(spec.frequency, RATE, spec.seconds)], RATE));
      },
    },
  });
  return { pack, reads };
}

const SEMITONES_2 = 2 ** (2 / 12);

describe('SfzPack under the memory manager and the sampler', () => {
  it('reads SFZ text at load and decodes a sample only when it is first played', async () => {
    const { pack, reads } = packOf();
    const instrument = await pack.loadInstrument('synthetic.sfz', { id: 'sfz:synthetic:default' });
    expect([...reads].sort()).toEqual(['common.sfzh', 'synthetic.sfz']);

    const context = offline(1.5);
    const source = new ManagedSampleSource(pack, context, {
      schedule: (run) => {
        run();
      },
    });
    expect(source.memory().decodedBytes).toBe(0);

    const missed: string[] = [];
    const sampler = new Sampler(context, {
      onMiss: (_track, sample) => {
        missed.push(sample);
        void source.getBuffer(sample);
      },
    });
    sampler.master.input.disconnect();
    sampler.master.input.connect(context.destination);
    sampler.addTrack(TRACK, { regions: instrument.regions, source });

    // First strike: not resident, so the note is skipped and its samples requested. Key 51 is
    // the ride and, at this velocity, one piano region of the fixture.
    expect(sampler.noteOn('t', { key: 51, velocity: 100, when: 0 })).toBeUndefined();
    expect([...missed].sort()).toEqual([
      'sfz:synthetic/samples/piano loud C3.wav',
      'sfz:synthetic/samples/ride.wav',
    ]);
    await source.settled();
    expect(reads.filter((path) => path.startsWith('samples/')).sort()).toEqual([
      'samples/piano loud C3.wav',
      'samples/ride.wav',
    ]);

    // The one-shot ring: a note-off at 0.2 s does not cut it.
    const handle = sampler.noteOn('t', { key: 51, velocity: 100, when: 0 });
    if (!handle) throw new Error('the ride should be resident');
    sampler.noteOff(handle, 0.2);
    const rendered = (await context.startRendering()).getChannelData(0);
    expect(rms(rendered, 0.05, 0.19)).toBeGreaterThan(0.05);
    expect(rms(rendered, 0.4, 0.9)).toBeGreaterThan(0.05);

    // The pack's release region is on key 60 only: the note-off of key 51 matches none, so it is
    // silent and its sample is never requested.
    expect([...missed]).not.toContain('sfz:synthetic/samples/release.wav');
    await source.settled();

    // Accounting is the decoded Float32 size, counted once.
    const memory = source.memory();
    expect(memory.decodedBytes).toBe((frames('ride.wav') + frames('piano loud C3.wav')) * 4);
    expect(memory.residents).toEqual(['sfz:synthetic:default']);
    expect(source.counters.fetches).toBe(2);
    expect(pack.byteLength('sfz:synthetic/samples/ride.wav')).toBe(frames('ride.wav') * 4);
  });

  it('preloads every round-robin and random take and the release of a key through candidates()', async () => {
    const { pack, reads } = packOf();
    const instrument = await pack.loadInstrument('synthetic.sfz', { id: 'a' });
    const source = new ManagedSampleSource(pack, offline(0.1), {
      schedule: (run) => {
        run();
      },
    });
    const refs = [...new Set(instrument.regions.candidates(60, 64).map((r) => r.sample))].sort();
    const names = refs.map((ref) => ref.slice('sfz:synthetic/samples/'.length));
    expect(names).toEqual(
      [
        'rr1.wav',
        'rr2.wav',
        'release.wav',
        'rand low.wav',
        'rand high.wav',
        'attack first.wav',
        'attack legato.wav',
        'ks sustain.wav',
      ].sort(),
    );
    await Promise.all(refs.map((ref) => source.getBuffer(ref)));
    const read = reads.filter((path) => path.startsWith('samples/')).sort();
    expect(read).toEqual(names.map((name) => `samples/${name}`).sort());
    // A release region is a candidate, since it must be resident at the note-off.
    expect(read).toContain('samples/release.wav');
    const expected = names.reduce((sum, name) => sum + frames(name) * 4, 0);
    expect(source.memory().decodedBytes).toBe(expected);
    expect(source.counters.fetches).toBe(names.length);
  });

  it('plays the keyswitch layer a note asks for', async () => {
    const { pack } = packOf();
    const instrument = await pack.loadInstrument('synthetic.sfz', { id: 'a' });
    expect(instrument.layers.map((layer) => layer.id)).toEqual(['sw:24', 'sw:25', 'sw:26']);
    const source = new ManagedSampleSource(pack, offline(0.1), {
      schedule: (run) => {
        run();
      },
    });
    const levels: Record<string, { sustain: number; mute: number }> = {};
    for (const layer of ['sw:24', 'sw:25']) {
      const context = offline(0.4);
      const sampler = new Sampler(context);
      sampler.master.input.disconnect();
      sampler.master.input.connect(context.destination);
      sampler.addTrack(TRACK, { regions: instrument.regions, source });
      for (const region of instrument.regions.resolveAll(62, 90, layer)) {
        await source.getBuffer(region.sample);
      }
      sampler.noteOn('t', { key: 62, velocity: 90, when: 0, layer });
      const data = (await context.startRendering()).getChannelData(0);
      levels[layer] = {
        sustain: toneLevel(data, 200 * SEMITONES_2, 0.05, 0.3),
        mute: toneLevel(data, 300 * SEMITONES_2, 0.05, 0.3),
      };
    }
    expect(levels['sw:24']?.sustain).toBeGreaterThan(0.1);
    expect(levels['sw:24']?.mute).toBeLessThan(0.02);
    expect(levels['sw:25']?.mute).toBeGreaterThan(0.1);
    expect(levels['sw:25']?.sustain).toBeLessThan(0.02);
  });
});
