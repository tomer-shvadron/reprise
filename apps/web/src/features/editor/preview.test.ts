import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { previewOptions } from './preview';

const built = score()
  .tempo(60)
  .track('guitar')
  .bar()
  .beat('4', [note(1, 3)])
  .beat('8.', [note(2, 5, { dynamics: 'pp' })])
  .beat('8t', [note(1, 0)])
  .bar()
  .tempo(120)
  .beat('2', [note(1, 0)])
  .beat('2', [note(1, 0, { tie: true })])
  .voice(1)
  .beat('4', [note(6, 2)])
  .bar()
  .tempo(30)
  .beat('1', [note(1, 0)])
  .build();

const sound = (bar: number, index: number, string: number, voice = 0) => ({
  track: built.tracks[0]?.id ?? '',
  beat: built.tracks[0]?.bars[bar]?.voices[voice]?.beats[index]?.id ?? '',
  string,
  fret: 0,
});

describe('previewOptions', () => {
  it('maps the beat length to seconds at the tempo in force', () => {
    expect(previewOptions(built, sound(0, 0, 1)).seconds).toBeCloseTo(1);
    expect(previewOptions(built, sound(0, 1, 2)).seconds).toBeCloseTo(0.75);
    expect(previewOptions(built, sound(1, 0, 1)).seconds).toBeCloseTo(1);
  });

  it('times a triplet eighth, a second-voice beat and a tied beat by their own length', () => {
    // A triplet eighth is a third of a quarter: 1/3 s at 60 bpm.
    expect(previewOptions(built, sound(0, 2, 1)).seconds).toBeCloseTo(1 / 3);
    expect(previewOptions(built, sound(1, 0, 6, 1)).seconds).toBeCloseTo(0.5);
    expect(previewOptions(built, sound(1, 1, 1)).seconds).toBeCloseTo(1);
  });

  it('gives a whole note at a slow tempo more than the 5 s the audio service clamps to', () => {
    expect(previewOptions(built, sound(2, 0, 1)).seconds).toBeCloseTo(8);
  });

  it('follows a beat-level tempo change and its ramp', () => {
    const changed = score()
      .tempo(60)
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { mix: { tempo: { bpm: 120 } } })
      .build();
    const at = (index: number) => ({
      track: changed.tracks[0]?.id ?? '',
      beat: changed.tracks[0]?.bars[0]?.voices[0]?.beats[index]?.id ?? '',
      string: 1,
      fret: 0,
    });
    expect(previewOptions(changed, at(0)).seconds).toBeCloseTo(1);
    expect(previewOptions(changed, at(1)).seconds).toBeCloseTo(0.5);
  });

  it('maps the note dynamic to its velocity ladder step', () => {
    expect(previewOptions(built, sound(0, 0, 1)).velocity).toBe(95);
    expect(previewOptions(built, sound(0, 1, 2)).velocity).toBe(31);
  });

  it('returns no options for a beat the score lost', () => {
    expect(previewOptions(built, { track: 'x', beat: 'gone', string: 1, fret: 0 })).toEqual({});
  });
});
