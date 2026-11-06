import { RegionMap } from '../sampler/region-map';
import { SynthSampleSource } from '../sampler/sample-source';
import type { Instrument } from '../sampler/sampler';

/** The region's root: playing it unshifted keeps the noise's spectrum where it was made. */
export const DEAD_NOTE_KEY = 60;
const SAMPLE = 'fx:dead';

/**
 * A muted string's click for the GM tier, which has no sampled one: 100 ms of seeded noise
 * that the envelope cuts to a 50 ms burst. Synthesized on first use, so it costs nothing until
 * a score has a dead note.
 */
export function deadNoteInstrument(sampleRate: number): Instrument {
  return {
    regions: new RegionMap([
      {
        keyLo: 0,
        keyHi: 127,
        velLo: 1,
        velHi: 127,
        rootKey: DEAD_NOTE_KEY,
        tune: 0,
        sample: SAMPLE,
        envelope: { attack: 0.001, hold: 0, decay: 0.05, sustain: 0, release: 0.01 },
      },
    ]),
    source: new SynthSampleSource(sampleRate, {
      [SAMPLE]: { kind: 'noise', duration: 0.1, seed: 7, amplitude: 0.5 },
    }),
  };
}
