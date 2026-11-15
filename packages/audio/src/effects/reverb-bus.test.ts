import { describe, expect, it, vi } from 'vitest';

import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { offline, sineInstrument } from '../sampler/test/offline';
import { stagesOf } from './presets';
import type { EffectPresetId } from './presets';
import { ManualDefer, render, rms, toneLevel } from './test/measure';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };

function track(id: string, mute = false): SamplerTrack {
  return {
    id,
    kind: 'pitched',
    tuning: [],
    capo: 0,
    channel: { ...CHANNEL, mute, solo: false },
  };
}

function setup(ids: string[], preset: EffectPresetId, seconds = 1.5, mute = false) {
  const context = offline(seconds);
  const manual = new ManualDefer();
  const sampler = new Sampler(context, { defer: manual.defer });
  for (const id of ids) {
    sampler.addTrack(track(id, mute), sineInstrument());
    sampler.setEffects(id, stagesOf(preset));
  }
  return { context, manual, sampler };
}

describe('the shared reverb bus', () => {
  it('is one convolver for any number of tracks', () => {
    const context = offline(0.5);
    const create = vi.spyOn(context, 'createConvolver');
    const sampler = new Sampler(context, { defer: new ManualDefer().defer });
    for (const id of ['a', 'b', 'c']) {
      sampler.addTrack(track(id), sineInstrument());
      // Reverb only: no cabinet convolver besides the bus's.
      sampler.setEffects(id, stagesOf('keys'));
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(sampler.reverbBus).toBeDefined();
    expect(sampler.strip('a')?.reverbSend).toBeDefined();
    expect(sampler.strip('c')?.chain).toBeUndefined();
    sampler.dispose();
  });

  it('leaves no tail with a send of 0, and rings on with a send', async () => {
    const tail = async (preset: EffectPresetId): Promise<number> => {
      const { context, manual, sampler } = setup(['a'], preset);
      const voice = sampler.noteOn('a', { key: 69, velocity: 100, when: 0.05 });
      voice?.release(0.25);
      return rms((await render(context, manual)).getChannelData(0), 0.9, 1.4);
    };
    expect(await tail('off')).toBe(0);
    expect(await tail('keys')).toBeGreaterThan(1e-5);
  });

  it('is not fed by a muted strip', async () => {
    const { context, manual, sampler } = setup(['a'], 'keys', 1, true);
    sampler.noteOn('a', { key: 69, velocity: 100, when: 0.3 });
    // The gate closes over a few milliseconds from the start; by 0.3 s nothing is left of it.
    expect(rms((await render(context, manual)).getChannelData(0), 0.3, 1)).toBeLessThan(1e-12);
  });

  it('runs a preview through the chain, past the mute gate', async () => {
    const second = async (preset: EffectPresetId): Promise<number> => {
      const { context, manual, sampler } = setup(['a'], preset, 1, true);
      sampler.previewNote('a', { pitch: 69 }, { seconds: 0.8 });
      const out = (await render(context, manual)).getChannelData(0);
      return toneLevel(out, 1320, 0.2, 0.6) / toneLevel(out, 440, 0.2, 0.6);
    };
    expect(await second('distortion')).toBeGreaterThan(0.05);
    expect(await second('off')).toBeLessThan(0.001);
  });

  it('tears down with the sampler: sends and bus are gone, a later dispose is harmless', () => {
    const { sampler } = setup(['a', 'b'], 'distortion');
    sampler.dispose();
    expect(sampler.trackIds).toEqual([]);
    expect(sampler.strip('a')).toBeUndefined();
    expect(() => {
      sampler.dispose();
    }).not.toThrow();
  });
});
