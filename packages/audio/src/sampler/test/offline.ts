import { RegionMap } from '../region-map';
import type { Envelope, Region } from '../region-map';
import { SynthSampleSource } from '../sample-source';
import type { SampleSource } from '../sample-source';
import type { Instrument } from '../sampler';

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

function slice(data: Float32Array, from: number, to: number): Float32Array {
  return data.subarray(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
}

/** Mean frequency from interpolated rising zero crossings. */
export function zeroCrossingFrequency(data: Float32Array, from: number, to: number): number {
  const window = slice(data, from, to);
  let first: number | undefined;
  let last = 0;
  let crossings = 0;
  for (let i = 1; i < window.length; i += 1) {
    const before = window[i - 1] ?? 0;
    const after = window[i] ?? 0;
    if (before < 0 && after >= 0) {
      const at = i - 1 + before / (before - after);
      first ??= at;
      last = at;
      crossings += 1;
    }
  }
  if (first === undefined || crossings < 2) return 0;
  return ((crossings - 1) * SAMPLE_RATE) / (last - first);
}

export function cents(measured: number, expected: number): number {
  return 1200 * Math.log2(measured / expected);
}

export function rms(data: Float32Array, from: number, to: number): number {
  const window = slice(data, from, to);
  let sum = 0;
  for (const value of window) sum += value * value;
  return Math.sqrt(sum / Math.max(1, window.length));
}

export function peak(data: Float32Array, from: number, to: number): number {
  let max = 0;
  for (const value of slice(data, from, to)) max = Math.max(max, Math.abs(value));
  return max;
}

/** Amplitude of one frequency in a Hann-windowed span (Goertzel), 1 for a full-scale sine. */
export function toneLevel(data: Float32Array, frequency: number, from: number, to: number): number {
  const window = slice(data, from, to);
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / SAMPLE_RATE);
  let previous = 0;
  let beforePrevious = 0;
  let weights = 0;
  for (const [index, value] of window.entries()) {
    const weight = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (window.length - 1));
    weights += weight;
    const current = value * weight + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  const power =
    previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / Math.max(1, weights);
}
