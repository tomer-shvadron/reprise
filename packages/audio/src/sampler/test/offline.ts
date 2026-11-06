import { RegionMap } from '../region-map';
import type { Envelope, Region } from '../region-map';
import { SynthSampleSource } from '../sample-source';
import type { SampleSource } from '../sample-source';
import type { Instrument } from '../sampler';
import * as measure from '../../test/signal';
import type { Signal } from '../../test/signal';

export const SAMPLE_RATE = 44_100;

export function offline(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
}

export const ORGAN: Envelope = { attack: 0.005, hold: 0, decay: 0, sustain: 1, release: 0.05 };

export function region(spec: Partial<Region> = {}): Region {
  return {
    keyLo: 0,
    keyHi: 127,
    velLo: 1,
    velHi: 127,
    rootKey: 69,
    tune: 0,
    sample: 'a440',
    envelope: ORGAN,
    ...spec,
  };
}

/** One 440 Hz sine rooted at A4 across the keyboard, long enough not to need a loop. */
export function sineInstrument(envelope: Envelope = ORGAN, seconds = 6): Instrument {
  return {
    regions: new RegionMap([region({ envelope })]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      a440: { kind: 'sine', frequency: 440, duration: seconds },
    }),
  };
}

/** One two-channel sample, a different sine per side, as a merged SF2 pair arrives. */
export function stereoInstrument(left: number, right: number, seconds = 1): Instrument {
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = new AudioBuffer({ length, sampleRate: SAMPLE_RATE, numberOfChannels: 2 });
  for (const [channel, frequency] of [left, right].entries()) {
    const data = buffer.getChannelData(channel);
    const step = (2 * Math.PI * frequency) / SAMPLE_RATE;
    for (let i = 0; i < length; i += 1) data[i] = 0.5 * Math.sin(step * i);
  }
  const source: SampleSource = {
    getBuffer: () => Promise.resolve(buffer),
    peekBuffer: () => buffer,
  };
  return { regions: new RegionMap([region()]), source };
}

const signal = (data: Float32Array): Signal => ({ data, sampleRate: SAMPLE_RATE });

/** Mean frequency from interpolated rising zero crossings. */
export function zeroCrossingFrequency(data: Float32Array, from: number, to: number): number {
  return measure.zeroCrossingFrequency(signal(data), from, to);
}

export { cents } from '../../test/signal';

export function rms(data: Float32Array, from: number, to: number): number {
  return measure.rms(signal(data), from, to);
}

export function peak(data: Float32Array, from: number, to: number): number {
  return measure.peak(signal(data), from, to);
}

/** Amplitude of one frequency in a Hann-windowed span (Goertzel), 1 for a full-scale sine. */
export function toneLevel(data: Float32Array, frequency: number, from: number, to: number): number {
  return measure.toneLevel(signal(data), frequency, from, to);
}
