import { describe, expect, it } from 'vitest';

import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { offline, peak, rms, sineInstrument } from '../sampler/test/offline';
import { EFFECT_PRESETS, channelEffects } from './presets';
import type { EffectSpec } from './presets';
import { ManualDefer, render } from './test/measure';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };

const strip: SamplerTrack = {
  id: 'a',
  kind: 'pitched',
  tuning: [],
  capo: 0,
  channel: { ...CHANNEL, mute: false, solo: false },
};

/** A 440 Hz note from 0.05 s to 0.2 s through a GM-tier strip with the channel's effects. */
async function play(reverb: number, chorus: number, withEffects = true, spec?: EffectSpec) {
  const context = offline(1.6);
  const manual = new ManualDefer();
  const sampler = new Sampler(context, { defer: manual.defer });
  sampler.addTrack(strip, sineInstrument());
  if (withEffects) sampler.setEffects('a', spec ?? channelEffects({ reverb, chorus }));
  sampler.noteOn('a', { key: 69, velocity: 60, when: 0.05 })?.release(0.2);
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

  it('leaves a tail at reverb 127, about 32 dB under the note, and half the send is 6 dB less', async () => {
    const [dry] = await play(0, 0);
    const [wet] = await play(127, 0);
    const [half] = await play(64, 0);
    // The dry render is silent after the release, so any tail is the reverb's.
    expect(rms(dry, 0.4, 1)).toBe(0);
    const level = (data: Float32Array) => 20 * Math.log10(rms(data, 0.4, 1) / rms(wet, 0.1, 0.2));
    // Measured -32 dB: a mapping that divided by 127 twice would be near -74.
    expect(level(wet)).toBeGreaterThan(-38);
    expect(level(wet)).toBeLessThan(-26);
    // CC 64 is 0.504 of CC 127: -5.9 dB, as the linear mapping says.
    expect(level(half) - level(wet)).toBeGreaterThan(-7.5);
    expect(level(half) - level(wet)).toBeLessThan(-4.5);
  });

  it('widens a centred note at chorus 127 and not at 0', async () => {
    const side = (left: Float32Array, right: Float32Array) =>
      left.reduce((max, value, index) => Math.max(max, Math.abs(value - (right[index] ?? 0))), 0);
    expect(side(...(await play(0, 0)))).toBe(0);
    expect(side(...(await play(0, 127)))).toBeGreaterThan(1e-3);
  });

  it('stays within the headroom of a preset and under the ceiling knee with both at 127', async () => {
    const [left, right] = await play(127, 127);
    const [reference] = await play(0, 0, true, EFFECT_PRESETS.clean);
    const top = Math.max(peak(left, 0, 1.6), peak(right, 0, 1.6));
    // The `clean` preset (chorus 0.35, send 0.12) is the nearest sound the presets' 3 dB level pin
    // covers; the knee is where the master ceiling would start to bend the signal.
    expect(top).toBeLessThan(peak(reference, 0, 1.6) * 10 ** (3 / 20));
    expect(top).toBeLessThan(10 ** (-1 / 20));
  });
});
