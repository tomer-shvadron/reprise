import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import type { Region } from './region-map';
import { SynthSampleSource } from './sample-source';
import { Sampler } from './sampler';
import type { Instrument, SamplerTrack } from './sampler';
import { SAMPLE_RATE, offline, region, toneLevel } from './test/offline';

const NOTE = 440;
const TAIL = 1100;

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

const sine = (frequency: number, duration: number) =>
  ({ kind: 'sine', frequency, duration }) as const;

/** A held 440 Hz note with a 0.3 s 1100 Hz release sample, and any extra regions. */
function guitar(release: Partial<Region> = {}, extra: Region[] = []): Instrument {
  return {
    regions: new RegionMap([
      region({ sample: 'note' }),
      region({ sample: 'tail', trigger: 'release', ...release }),
      ...extra,
    ]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      note: sine(NOTE, 4),
      tail: sine(TAIL, 0.3),
      tail2: sine(TAIL * 1.5, 0.3),
    }),
  };
}

function setup(seconds: number, instrument: Instrument, polyphony?: number) {
  const context = offline(seconds);
  const sampler = new Sampler(context, polyphony === undefined ? {} : { polyphony });
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  sampler.addTrack(TRACK, instrument);
  return { context, sampler };
}

const render = async (context: OfflineAudioContext) =>
  (await context.startRendering()).getChannelData(0);

describe('release regions play at the note-off', () => {
  it('starts the release sample at the release time and not before', async () => {
    const { context, sampler } = setup(1.2, guitar());
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    sampler.noteOff(handle ?? fail('no voice'), 0.5);
    const data = await render(context);
    expect(toneLevel(data, TAIL, 0.1, 0.45)).toBeLessThan(0.001);
    expect(toneLevel(data, TAIL, 0.55, 0.75)).toBeGreaterThan(0.1);
    expect(toneLevel(data, NOTE, 0.7, 1)).toBeLessThan(0.01);
  });

  it('plays it as a one-shot: a later release does not cut it, the sample plays to its end', async () => {
    const { context, sampler } = setup(1.2, guitar());
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    handle?.release(0.2);
    handle?.release(0.3);
    const data = await render(context);
    expect(toneLevel(data, TAIL, 0.25, 0.45)).toBeGreaterThan(0.1);
    expect(toneLevel(data, TAIL, 0.4, 0.48)).toBeGreaterThan(0.1);
    expect(toneLevel(data, TAIL, 0.6, 1)).toBeLessThan(0.001);
  });

  it('starts it once, however often the handle is released', () => {
    const { sampler } = setup(1, guitar());
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    handle?.release(0.2);
    const count = sampler.pool.active(0.25).length;
    handle?.release(0.3);
    expect(sampler.pool.active(0.25)).toHaveLength(count);
  });

  it('starts it at a let-ring note until time, and not for a let-ring note nothing releases', async () => {
    const { context, sampler } = setup(1.2, guitar());
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0, letRing: { until: 0.4 } });
    const data = await render(context);
    expect(toneLevel(data, TAIL, 0.1, 0.35)).toBeLessThan(0.001);
    expect(toneLevel(data, TAIL, 0.45, 0.65)).toBeGreaterThan(0.1);

    const ringing = setup(1.2, guitar());
    const held = ringing.sampler.noteOn('t', { key: 69, velocity: 127, when: 0, letRing: true });
    ringing.sampler.noteOff(held ?? fail('no voice'), 0.4);
    expect(toneLevel(await render(ringing.context), TAIL, 0.45, 0.65)).toBeLessThan(0.001);
  });

  it('chooses the release region by the note select, like the note', async () => {
    const instrument: Instrument = guitar({ sequence: { length: 2, position: 1 } }, [
      region({ sample: 'tail2', trigger: 'release', sequence: { length: 2, position: 2 } }),
    ]);
    const { context, sampler } = setup(1.2, instrument);
    const handle = sampler.noteOn('t', {
      key: 69,
      velocity: 127,
      when: 0,
      select: { sequence: 1 },
    });
    handle?.release(0.2);
    const data = await render(context);
    expect(toneLevel(data, TAIL * 1.5, 0.25, 0.45)).toBeGreaterThan(0.1);
    expect(toneLevel(data, TAIL, 0.25, 0.45)).toBeLessThan(0.001);
  });

  it('lowers it by rt_decay for each second the note was held', async () => {
    const level = async (held: number): Promise<number> => {
      const { context, sampler } = setup(held + 0.6, guitar({ releaseDecay: 20 }));
      sampler.noteOn('t', { key: 69, velocity: 127, when: 0 })?.release(held);
      return toneLevel(await render(context), TAIL, held + 0.05, held + 0.25);
    };
    const short = await level(0.1);
    const long = await level(1);
    // 0.9 s more held at 20 dB/s is 18 dB.
    expect(long / short).toBeCloseTo(10 ** (-18 / 20), 1);
  });
});

describe('what never starts a release region', () => {
  it('a string choke: the next note on the string cuts the note without its tail', async () => {
    const { context, sampler } = setup(1.2, guitar());
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0, string: 1 });
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.4, string: 1 });
    expect(toneLevel(await render(context), TAIL, 0.45, 0.65)).toBeLessThan(0.001);
  });

  it('a choke that came before the release: the note is cut, so it has no tail', async () => {
    const { context, sampler } = setup(1.2, guitar());
    const first = sampler.noteOn('t', { key: 69, velocity: 127, when: 0, string: 1 });
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.4, string: 1 });
    first?.release(0.6);
    expect(toneLevel(await render(context), TAIL, 0.65, 0.85)).toBeLessThan(0.001);
  });

  it('a steal', async () => {
    const { context, sampler } = setup(1.2, guitar(), 1);
    const first = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    sampler.noteOn('t', { key: 71, velocity: 127, when: 0.3 });
    first?.release(0.6);
    expect(sampler.pool.stolen).toBe(1);
    expect(toneLevel(await render(context), TAIL, 0.65, 0.85)).toBeLessThan(0.001);
  });

  it('allNotesOff, which also silences a release still waiting to start', async () => {
    const { context, sampler } = setup(1.2, guitar());
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 })?.release(0.6);
    sampler.noteOn('t', { key: 71, velocity: 127, when: 0 });
    sampler.allNotesOff(0.4);
    const data = await render(context);
    expect(toneLevel(data, TAIL, 0.1, 1)).toBeLessThan(0.001);
    expect(toneLevel(data, NOTE, 0.5, 1)).toBeLessThan(0.001);
  });

  it('a preview, which sounds its note and no release region', async () => {
    const { context, sampler } = setup(1.2, guitar());
    sampler.previewNote('t', { pitch: 69 }, { seconds: 0.3 });
    const data = await render(context);
    expect(toneLevel(data, NOTE, 0.05, 0.3)).toBeGreaterThan(0.1);
    expect(toneLevel(data, TAIL, 0.3, 1)).toBeLessThan(0.001);
  });
});

describe('release voices and the pool', () => {
  it('sit outside the string choke: the next note on the string does not cut the tail', async () => {
    const { context, sampler } = setup(1.2, guitar());
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0, string: 1 })?.release(0.4);
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.4, string: 1 });
    const data = await render(context);
    expect(toneLevel(data, TAIL, 0.45, 0.65)).toBeGreaterThan(0.1);
    expect(toneLevel(data, NOTE, 0.45, 0.65)).toBeGreaterThan(0.1);
  });

  it('count inside the polyphony: at the cap a new note takes the quiet tail', async () => {
    const { context, sampler } = setup(1.2, guitar(), 2);
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 })?.release(0.2);
    expect(sampler.pool.active(0.3)).toHaveLength(1);
    sampler.noteOn('t', { key: 71, velocity: 127, when: 0.3 });
    expect(sampler.pool.stolen).toBe(0);
    sampler.noteOn('t', { key: 73, velocity: 127, when: 0.3 });
    expect(sampler.pool.stolen).toBe(1);
    expect(toneLevel(await render(context), TAIL, 0.4, 0.5)).toBeLessThan(0.001);
  });

  it('a release sample that is not resident is a miss, reported and requested', () => {
    const source = new SynthSampleSource(
      SAMPLE_RATE,
      { note: sine(NOTE, 4), tail: sine(TAIL, 0.3) },
      { deferred: true },
    );
    const misses: string[] = [];
    const context = offline(1);
    const sampler = new Sampler(context, { onMiss: (_track, sample) => misses.push(sample) });
    sampler.addTrack(TRACK, { regions: guitar().regions, source });
    return source.getBuffer('note').then(() => {
      sampler.noteOn('t', { key: 69, velocity: 127, when: 0 })?.release(0.2);
      expect(misses).toEqual(['tail']);
      expect(source.requests).toBe(2);
    });
  });
});

function fail(message: string): never {
  throw new Error(message);
}
