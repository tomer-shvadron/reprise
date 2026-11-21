import { validateScore } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { sliceScore } from './slice-score';

function source() {
  return score()
    .title('Slice')
    .track('guitar')
    .bar()
    .tempo(100)
    .beat('1', [note(1, 3)])
    .bar()
    .beat('1', [note(2, 5)])
    .bar({ clef: 'bass' })
    .tempo(140)
    .beat('1', [note(3, 7)])
    .bar()
    .beat('1', [note(3, 7, { tie: true })])
    .bar()
    .beat('1', [note(3, 7, { tie: true })])
    .build({ ids: 'sequential' });
}

describe('sliceScore', () => {
  it('copies the bars of the range, from every track', () => {
    const built = source();
    const slice = sliceScore(built, 1, 4);
    expect(slice.masterBars).toHaveLength(3);
    expect(slice.tracks[0]?.bars).toHaveLength(3);
    expect(slice.tracks[0]?.bars[0]?.id).toBe(built.tracks[0]?.bars[1]?.id);
  });

  it('gives the first bar the tempo in effect there', () => {
    const slice = sliceScore(source(), 1, 3);
    expect(slice.masterBars[0]?.tempo?.bpm).toBe(100);
    expect(slice.masterBars[1]?.tempo?.bpm).toBe(140);
    expect(sliceScore(source(), 3, 5).masterBars[0]?.tempo?.bpm).toBe(140);
  });

  it('gives each track the clef in effect at its first bar', () => {
    expect(sliceScore(source(), 3, 5).tracks[0]?.bars[0]?.clef).toBe('bass');
    expect(sliceScore(source(), 1, 3).tracks[0]?.bars[0]?.clef).toBeUndefined();
  });

  it('clears a tie whose origin is before the range and keeps one inside it', () => {
    const built = source();
    const slice = sliceScore(built, 3, 5);
    const [first, second] = slice.tracks[0]?.bars ?? [];
    expect(first?.voices[0].beats[0]?.notes[0]?.tie).toBe(false);
    expect(second?.voices[0].beats[0]?.notes[0]?.tie).toBe(true);
    // The tie was fine in the source; the slice is a valid score too.
    expect(validateScore(slice)).toEqual([]);
  });

  it('leaves the source untouched', () => {
    const built = source();
    const before = JSON.stringify(built);
    sliceScore(built, 3, 5);
    expect(JSON.stringify(built)).toBe(before);
  });

  it('clamps a range that runs past the score', () => {
    const slice = sliceScore(source(), 4, 99);
    expect(slice.masterBars).toHaveLength(1);
  });
});
