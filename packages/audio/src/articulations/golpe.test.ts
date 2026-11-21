import { describe, expect, it } from 'vitest';

import { rms, signalOf, zeroCrossingFrequency } from '../test/signal';
import { GOLPE_KEY, golpeInstrument } from './golpe';
import { ARTICULATION } from './parameters';
import { scrapeInstrument } from './scrape';

const SAMPLE_RATE = 44_100;

function buffer(instrument: ReturnType<typeof golpeInstrument>, sample: string) {
  const found = instrument.source.peekBuffer(sample);
  if (!found) throw new Error(`no ${sample}`);
  return signalOf(found);
}

describe('golpeInstrument', () => {
  const instrument = golpeInstrument(SAMPLE_RATE);

  it('layers a body and a noise burst on each key, with no sample shipped', () => {
    for (const kind of ['thumb', 'finger'] as const) {
      const regions = instrument.regions.resolveAll(GOLPE_KEY[kind], 80);
      expect(regions.map((region) => region.sample).sort()).toEqual([
        `fx:golpe-${kind}-body`,
        `fx:golpe-${kind}-noise`,
      ]);
    }
  });

  it('makes the thumb lower and rounder than the finger', () => {
    const thumbBody = buffer(instrument, 'fx:golpe-thumb-body');
    const fingerBody = buffer(instrument, 'fx:golpe-finger-body');
    const thumbHz = zeroCrossingFrequency(thumbBody, 0, 0.1);
    const fingerHz = zeroCrossingFrequency(fingerBody, 0, 0.1);
    expect(thumbHz).toBeGreaterThan(ARTICULATION.golpe.thumb.endFrequency);
    expect(thumbHz).toBeLessThan(fingerHz);
    // The noise follows the same order: a 400 Hz low-pass crosses zero far less than a 3 kHz one.
    const thumbNoise = zeroCrossingFrequency(buffer(instrument, 'fx:golpe-thumb-noise'), 0, 0.03);
    const fingerNoise = zeroCrossingFrequency(
      buffer(instrument, 'fx:golpe-finger-noise'),
      0,
      0.015,
    );
    expect(thumbNoise).toBeLessThan(fingerNoise);
  });

  it('has audible energy in a short burst', () => {
    for (const sample of ['fx:golpe-thumb-body', 'fx:golpe-thumb-noise', 'fx:golpe-finger-noise']) {
      expect(rms(buffer(instrument, sample), 0, 0.01)).toBeGreaterThan(0.05);
    }
  });
});

describe('scrapeInstrument', () => {
  it('is seeded noise long enough for an octave-up sweep over the capped note', () => {
    const instrument = scrapeInstrument(SAMPLE_RATE);
    const noise = buffer(instrument, 'fx:scrape');
    expect(noise.data.length / SAMPLE_RATE).toBeGreaterThanOrEqual(
      ARTICULATION.pickScrape.maxLength * 1.5,
    );
    expect(rms(noise, 0, 0.5)).toBeGreaterThan(0.1);
    expect(buffer(scrapeInstrument(SAMPLE_RATE), 'fx:scrape').data[100]).toBe(noise.data[100]);
  });
});
