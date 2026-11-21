import { RegionMap } from '../sampler/region-map';
import type { Region } from '../sampler/region-map';
import { SynthSampleSource } from '../sampler/sample-source';
import type { SynthSample } from '../sampler/sample-source';
import type { Instrument } from '../sampler/sampler';
import { ARTICULATION } from './parameters';

/** The keys the two hits are played at, each the root of its own regions: no pitch shift. */
export const GOLPE_KEY = { thumb: 60, finger: 61 } as const;

/**
 * The golpe's body hit for every tier, which no soundfont of ours carries: per kind a falling
 * sine and a short low-passed noise burst, layered as two regions on one key. Synthesized on
 * first use, so it costs nothing until a score has a golpe.
 */
export function golpeInstrument(sampleRate: number): Instrument {
  const { thumb, finger, noiseAmplitude } = ARTICULATION.golpe;
  const samples: Record<string, SynthSample> = {};
  const regions: Region[] = [];
  for (const [kind, spec] of [
    ['thumb', thumb],
    ['finger', finger],
  ] as const) {
    const key = GOLPE_KEY[kind];
    const base = { keyLo: key, keyHi: key, velLo: 1, velHi: 127, rootKey: key, tune: 0 };
    samples[`fx:golpe-${kind}-body`] = {
      kind: 'sine',
      frequency: spec.frequency,
      endFrequency: spec.endFrequency,
      duration: spec.decay * 3,
      amplitude: 0.9,
    };
    samples[`fx:golpe-${kind}-noise`] = {
      kind: 'noise',
      duration: spec.noiseLength * 3,
      seed: kind === 'thumb' ? 11 : 13,
      amplitude: noiseAmplitude,
      cutoff: spec.noiseCutoff,
    };
    regions.push(
      {
        ...base,
        sample: `fx:golpe-${kind}-body`,
        envelope: { attack: 0.001, hold: 0, decay: spec.decay, sustain: 0, release: 0.02 },
      },
      {
        ...base,
        sample: `fx:golpe-${kind}-noise`,
        envelope: { attack: 0.0005, hold: 0, decay: spec.noiseLength, sustain: 0, release: 0.01 },
      },
    );
  }
  return { regions: new RegionMap(regions), source: new SynthSampleSource(sampleRate, samples) };
}
