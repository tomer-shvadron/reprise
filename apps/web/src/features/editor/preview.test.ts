import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { previewOptions } from './preview';

const built = score()
  .tempo(60)
  .track('guitar')
  .bar()
  .beat('4', [note(1, 3)])
  .beat('8.', [note(2, 5, { dynamics: 'pp' })])
  .bar()
  .tempo(120)
  .beat('2', [note(1, 0)])
  .build();

const sound = (bar: number, index: number, string: number) => ({
  track: built.tracks[0]?.id ?? '',
  beat: built.tracks[0]?.bars[bar]?.voices[0]?.beats[index]?.id ?? '',
  string,
  fret: 0,
});

describe('previewOptions', () => {
  it('maps the beat length to seconds at the tempo in force', () => {
    expect(previewOptions(built, sound(0, 0, 1)).seconds).toBeCloseTo(1);
    expect(previewOptions(built, sound(0, 1, 2)).seconds).toBeCloseTo(0.75);
    expect(previewOptions(built, sound(1, 0, 1)).seconds).toBeCloseTo(1);
  });

  it('maps the note dynamic to its velocity ladder step', () => {
    expect(previewOptions(built, sound(0, 0, 1)).velocity).toBe(95);
    expect(previewOptions(built, sound(0, 1, 2)).velocity).toBe(31);
  });

  it('returns no options for a beat the score lost', () => {
    expect(previewOptions(built, { track: 'x', beat: 'gone', string: 1, fret: 0 })).toEqual({});
  });
});
