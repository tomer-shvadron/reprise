import { describe, expect, it } from 'vitest';

import { fitScale } from './scale-fit';
import { SCALES, scalePitchClasses, scaleOf, type ScaleId } from './scales';

const histogramOf = (tonic: number, id: ScaleId, extra: Record<number, number> = {}) => {
  const bins = new Array<number>(12).fill(0);
  for (const pc of scalePitchClasses(scaleOf(id), tonic)) bins[pc] = 1;
  for (const [pc, weight] of Object.entries(extra)) bins[Number(pc)] = weight;
  return bins;
};

describe('fitScale', () => {
  it.each(SCALES.map((scale) => scale.id))('names %s on its own tones', (id) => {
    const fit = fitScale(histogramOf(2, id), 2);
    expect(fit?.scale).toBe(id);
    expect(fit?.coverage).toBeCloseTo(1);
    expect(fit?.outside).toEqual([]);
  });

  it('prefers the smaller scale that explains the notes', () => {
    // A minor pentatonic is inside the natural minor; the pentatonic is the answer.
    const fit = fitScale(histogramOf(9, 'minorPentatonic'), 9);
    expect(fit?.scale).toBe('minorPentatonic');
    expect(fit?.alsoFits.map((entry) => entry.scale)).toContain('aeolian');
  });

  it('names the blues when the flat fifth leans', () => {
    expect(fitScale(histogramOf(4, 'blues'), 4)?.scale).toBe('blues');
  });

  it('lists the outside tones when nothing reaches 95%', () => {
    // C major with a heavy C sharp and F sharp.
    const fit = fitScale(histogramOf(0, 'ionian', { 1: 1, 6: 0.5 }), 0);
    expect(fit?.coverage).toBeLessThan(0.95);
    expect(fit?.outside[0]).toMatchObject({ pitchClass: 1 });
    expect(fit?.outside.map((o) => o.pitchClass)).toContain(6);
  });

  it('flags mixed thirds', () => {
    const fit = fitScale(histogramOf(4, 'blues', { 8: 1 }), 4);
    expect(fit?.mixedThirds).toBe(true);
    expect(fitScale(histogramOf(0, 'ionian'), 0)?.mixedThirds).toBe(false);
  });

  it('has no fit for an empty histogram', () => {
    expect(fitScale(new Array<number>(12).fill(0), 0)).toBeUndefined();
  });

  describe('with the key quality', () => {
    it('never gives a minor key a major-third scale, or a major key a minor-third one', () => {
      expect(fitScale(histogramOf(0, 'minorPentatonic'), 0, 'major')?.scale).not.toBe(
        'minorPentatonic',
      );
      expect(fitScale(histogramOf(0, 'majorPentatonic'), 0, 'minor')?.scale).not.toBe(
        'majorPentatonic',
      );
      expect(fitScale(histogramOf(0, 'minorPentatonic'), 0, 'minor')?.scale).toBe(
        'minorPentatonic',
      );
    });

    it('keeps the scales with both thirds for either quality', () => {
      expect(fitScale(histogramOf(0, 'majorBlues'), 0, 'major')?.scale).toBe('majorBlues');
      expect(fitScale(histogramOf(0, 'majorBlues'), 0, 'minor')?.scale).toBe('majorBlues');
    });

    it('limits a riff with no third to scales without one', () => {
      const bins = new Array<number>(12).fill(0);
      for (const pc of [0, 7, 10, 5]) bins[pc] = 1;
      expect(fitScale(bins, 0, 'none')?.scale).toBe('suspendedPentatonic');
    });

    it('reports no scale when none without a third covers the notes', () => {
      const bins = new Array<number>(12).fill(0);
      for (const pc of [0, 1, 6, 8]) bins[pc] = 1;
      expect(fitScale(bins, 0, 'none')).toBeUndefined();
    });
  });
});
