import { describe, expect, it } from 'vitest';

import { Sampler } from './sampler';
import type { SamplerTrack } from './sampler';
import { offline, rms, sineInstrument } from './test/offline';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };
/** 3.5 kHz: well above the closed pedal's 400 Hz band, so engaging it is plainly audible. */
const HIGH_KEY = 105;

const track: SamplerTrack = {
  id: 't',
  kind: 'fretted',
  tuning: [],
  capo: 0,
  channel: { ...CHANNEL, mute: false, solo: false },
};

/** A 3.5 kHz sine from 0 on one track, with `script` run before rendering `seconds`. */
async function render(
  seconds: number,
  script?: (sampler: Sampler) => void,
  notes: 'song' | 'preview' = 'song',
): Promise<Float32Array> {
  const context = offline(seconds);
  const sampler = new Sampler(context);
  // A sample three octaves up plays 8 times as fast, so it needs 8 times the length.
  sampler.addTrack(track, sineInstrument(undefined, seconds * 8));
  script?.(sampler);
  if (notes === 'song') sampler.noteOn(track.id, { key: HIGH_KEY, velocity: 100, when: 0 });
  else sampler.previewNote(track.id, { pitch: HIGH_KEY }, { seconds });
  return (await context.startRendering()).getChannelData(0);
}

function expectSame(a: Float32Array, b: Float32Array, from: number, to: number): void {
  let largest = 0;
  for (let i = Math.round(from * 44_100); i < Math.round(to * 44_100); i += 1) {
    largest = Math.max(largest, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  expect(largest).toBeLessThan(1e-6);
}

describe('a strip with a wah pedal', () => {
  it('builds no pedal for an off state it never had', () => {
    const sampler = new Sampler(offline(0.1));
    sampler.addTrack(track, sineInstrument());
    sampler.setWah(track.id, 'off', 0, true);
    expect(sampler.strip(track.id)?.wah).toBeUndefined();
    sampler.setWah(track.id, 'open', 0.1);
    expect(sampler.strip(track.id)?.wah).toBeDefined();
  });

  it('is spliced in silently: the signal is the dry one until the engage lands', async () => {
    const plain = await render(0.8);
    const swept = await render(0.8, (sampler) => {
      sampler.setWah(track.id, 'closed', 0.4);
    });
    expectSame(swept, plain, 0, 0.4);
    // Closed, the pedal leaves a small part of a 3.5 kHz tone, whatever the makeup gain.
    expect(rms(swept, 0.5, 0.8)).toBeLessThan(0.3 * rms(plain, 0.5, 0.8));
  });

  it('gives the dry signal exactly once turned off again', async () => {
    const plain = await render(1);
    const swept = await render(1, (sampler) => {
      sampler.setWah(track.id, 'open', 0.1);
      sampler.setWah(track.id, 'off', 0.4);
    });
    expect(rms(swept, 0.2, 0.35)).not.toBeCloseTo(rms(plain, 0.2, 0.35), 2);
    expectSame(swept, plain, 0.5, 1);
  });

  it('keeps a previewed note dry beside the pedal', async () => {
    const plain = await render(0.5, undefined, 'preview');
    const swept = await render(
      0.5,
      (sampler) => {
        sampler.setWah(track.id, 'closed', 0, true);
      },
      'preview',
    );
    expectSame(swept, plain, 0, 0.5);
  });

  it('drops a change scheduled past cancelAfter', async () => {
    const plain = await render(0.8);
    const cancelled = await render(0.8, (sampler) => {
      sampler.setWah(track.id, 'closed', 0.4);
      sampler.strip(track.id)?.cancelAfter(0.2);
    });
    expectSame(cancelled, plain, 0, 0.8);
  });
});
