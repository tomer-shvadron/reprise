import { describe, expect, it } from 'vitest';

import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { offline, peak, rms, sineInstrument } from '../sampler/test/offline';
import { channelEffects } from './presets';
import { ManualDefer, render } from './test/measure';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };

const strip: SamplerTrack = {
  id: 'a',
  kind: 'pitched',
  tuning: [],
  capo: 0,
  channel: { ...CHANNEL, mute: false, solo: false },
};

/** A 440 Hz note from 0.05 s to 0.45 s through a GM-tier strip with the channel's effects. */
async function play(reverb: number, chorus: number, withEffects = true) {
  const context = offline(1.6);
  const manual = new ManualDefer();
  const sampler = new Sampler(context, { defer: manual.defer });
  sampler.addTrack(strip, sineInstrument());
  if (withEffects) sampler.setEffects('a', channelEffects({ reverb, chorus }));
  sampler.noteOn('a', { key: 69, velocity: 100, when: 0.05 })?.release(0.45);
  const buffer = await render(context, manual);
  sampler.dispose();
  return [buffer.getChannelData(0), buffer.getChannelData(1)] as const;
}

describe('channel reverb and chorus on a GM-tier strip', () => {
  it('is bit-identical to no effects at 0 and 0', async () => {
    const [bare] = await play(0, 0, false);
    const [zero] = await play(0, 0);
    expect(Array.from(zero)).toEqual(Array.from(bare));
  });

  it('leaves a tail at reverb 127', async () => {
    const [dry] = await play(0, 0);
    const [wet] = await play(127, 0);
    // The dry render is silent after the release: any tail is the reverb's.
    const tail = rms(wet, 0.65, 1.25);
    expect(tail).toBeGreaterThan(1e-5);
    expect(rms(dry, 0.65, 1.25)).toBeLessThan(tail / 31.6);
  });

  it('widens a centred note at chorus 127 and not at 0', async () => {
    const side = (left: Float32Array, right: Float32Array) =>
      left.reduce((max, value, index) => Math.max(max, Math.abs(value - (right[index] ?? 0))), 0);
    expect(side(...(await play(0, 0)))).toBe(0);
    expect(side(...(await play(0, 127)))).toBeGreaterThan(1e-3);
  });

  it('stays under the master ceiling with both at 127', async () => {
    const [left, right] = await play(127, 127);
    expect(Math.max(peak(left, 0, 1.6), peak(right, 0, 1.6))).toBeLessThan(1);
  });
});
