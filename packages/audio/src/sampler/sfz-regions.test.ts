import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import type { Region } from './region-map';
import { SynthSampleSource } from './sample-source';
import type { SampleSource } from './sample-source';
import { Sampler } from './sampler';
import type { Instrument, SamplerTrack } from './sampler';
import { SAMPLE_RATE, offline, region, rms, toneLevel } from './test/offline';

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

const sine = (frequency: number, duration = 3) => ({ kind: 'sine', frequency, duration }) as const;

function setup(seconds: number): { context: OfflineAudioContext; sampler: Sampler } {
  const context = offline(seconds);
  const sampler = new Sampler(context);
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  return { context, sampler };
}

async function render(context: OfflineAudioContext): Promise<Float32Array> {
  return (await context.startRendering()).getChannelData(0);
}

/** One in-memory buffer at its own sample rate, as an SFZ file decodes. */
function bufferInstrument(
  regions: Region[],
  rate: number,
  fill: (frame: number) => number,
  seconds: number,
): Instrument {
  const length = Math.round(seconds * rate);
  const buffer = new AudioBuffer({ length, sampleRate: rate, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = fill(i);
  const source: SampleSource = {
    getBuffer: () => Promise.resolve(buffer),
    peekBuffer: () => buffer,
  };
  return { regions: new RegionMap(regions), source };
}

describe('frame-unit loops and offsets', () => {
  const rate = 22_050;
  // A noise-like but deterministic buffer, so a loop point off by a frame shows in the render.
  const fill = (i: number): number => Math.sin(i * i * 0.001) * 0.8;

  it('lands a frame loop at the same seconds as the equivalent seconds loop', async () => {
    const framed = region({ rootKey: 69, loop: { start: 500, end: 2000, unit: 'frames' } });
    const seconds = region({ rootKey: 69, loop: { start: 500 / rate, end: 2000 / rate } });
    const renders: Float32Array[] = [];
    for (const spec of [framed, seconds]) {
      const { context, sampler } = setup(0.6);
      sampler.addTrack(TRACK, bufferInstrument([spec], rate, fill, 0.2));
      sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
      renders.push(await render(context));
    }
    const [a, b] = renders;
    if (!a || !b) throw new Error('missing render');
    // Sustains well past the 0.2 s buffer, and matches the seconds loop sample for sample.
    expect(rms(a, 0.3, 0.5)).toBeGreaterThan(0.05);
    let worst = 0;
    for (let i = 0; i < a.length; i += 1)
      worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    expect(worst).toBeLessThan(1e-4);
  });

  it('starts startFrame frames into the sample', async () => {
    // Silence for the first half second, then a tone.
    const quiet = (i: number): number =>
      i < rate / 2 ? 0 : Math.sin((2 * Math.PI * 440 * i) / rate);
    const run = async (startFrame: number): Promise<number> => {
      const { context, sampler } = setup(0.3);
      const spec = region({ rootKey: 69, ...(startFrame > 0 && { startFrame }) });
      sampler.addTrack(TRACK, bufferInstrument([spec], rate, quiet, 1));
      sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
      const data = await render(context);
      return rms(data, 0.1, 0.25);
    };
    expect(await run(0)).toBeLessThan(0.001);
    expect(await run(rate / 2)).toBeGreaterThan(0.1);
  });
});

describe('velocityTrack', () => {
  it('0 ignores velocity and a missing value keeps the MIDI curve', async () => {
    const level = async (spec: Partial<Region>, velocity: number): Promise<number> => {
      const { context, sampler } = setup(0.4);
      sampler.addTrack(TRACK, {
        regions: new RegionMap([region(spec)]),
        source: new SynthSampleSource(SAMPLE_RATE, { a440: sine(440) }),
      });
      sampler.noteOn('t', { key: 69, velocity, when: 0 });
      return toneLevel(await render(context), 440, 0.1, 0.3);
    };
    expect(await level({ velocityTrack: 0 }, 30)).toBeCloseTo(
      await level({ velocityTrack: 0 }, 127),
      3,
    );
    expect(await level({}, 30)).toBeLessThan(0.2 * (await level({}, 127)));
    const half = await level({ velocityTrack: 0.5 }, 30);
    expect(half).toBeCloseTo((30 / 127) * (await level({}, 127)), 2);
  });
});

describe('one-shot', () => {
  it('rings past a note-off and stops on allNotesOff', async () => {
    const { context, sampler } = setup(1);
    sampler.addTrack(TRACK, {
      regions: new RegionMap([region({ oneShot: true })]),
      source: new SynthSampleSource(SAMPLE_RATE, { a440: sine(440) }),
    });
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    if (!handle) throw new Error('no voice');
    sampler.noteOff(handle, 0.1);
    handle.release(0.15);
    context.suspend(0.5).then(
      () => {
        sampler.allNotesOff(0.6);
        return context.resume();
      },
      () => undefined,
    );
    const data = await render(context);
    expect(toneLevel(data, 440, 0.2, 0.45)).toBeGreaterThan(0.5);
    expect(rms(data, 0.7, 0.95)).toBeLessThan(0.001);
  });
});

describe('group and offBy', () => {
  // SFZ hi-hat: the closed hat's group is the open hat's off_by, never the reverse.
  const kit = (): Instrument => ({
    regions: new RegionMap([
      region({ keyLo: 42, keyHi: 42, rootKey: 42, sample: 'closed', group: 2 }),
      region({ keyLo: 46, keyHi: 46, rootKey: 46, sample: 'open', group: 1, offBy: 2 }),
    ]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      closed: sine(3000),
      open: sine(5000),
    }),
  });

  it('closed cuts open', async () => {
    const { context, sampler } = setup(1);
    sampler.addTrack(TRACK, kit());
    sampler.noteOn('t', { key: 46, velocity: 127, when: 0 });
    sampler.noteOn('t', { key: 42, velocity: 127, when: 0.4 });
    const data = await render(context);
    expect(toneLevel(data, 5000, 0.1, 0.39)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 5000, 0.45, 0.9)).toBeLessThan(0.001);
  });

  it('open does not cut closed', async () => {
    const { context, sampler } = setup(1);
    sampler.addTrack(TRACK, kit());
    sampler.noteOn('t', { key: 42, velocity: 127, when: 0 });
    sampler.noteOn('t', { key: 46, velocity: 127, when: 0.4 });
    const data = await render(context);
    expect(toneLevel(data, 3000, 0.45, 0.9)).toBeGreaterThan(0.5);
  });
});
