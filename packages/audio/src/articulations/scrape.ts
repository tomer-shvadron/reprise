import { RegionMap } from '../sampler/region-map';
import { SynthSampleSource } from '../sampler/sample-source';
import type { Instrument } from '../sampler/sampler';
import { ARTICULATION } from './parameters';

const SAMPLE = 'fx:scrape';

/**
 * A pick scrape's noise for every tier: seeded white noise that the sink shapes with a bandpass
 * and a detune sweep (`planNote`), sustained until the note's release. Synthesized on first use.
 */
export function scrapeInstrument(sampleRate: number): Instrument {
  const { key, attack, release, bufferLength } = ARTICULATION.pickScrape;
  return {
    regions: new RegionMap([
      {
        keyLo: 0,
        keyHi: 127,
        velLo: 1,
        velHi: 127,
        rootKey: key,
        tune: 0,
        sample: SAMPLE,
        envelope: { attack, hold: 0, decay: 0, sustain: 1, release },
      },
    ]),
    source: new SynthSampleSource(sampleRate, {
      [SAMPLE]: { kind: 'noise', duration: bufferLength, seed: 23, amplitude: 0.6 },
    }),
  };
}
