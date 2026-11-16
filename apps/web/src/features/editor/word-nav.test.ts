import { describe, expect, it } from 'vitest';

import { cursorAtPosition } from './cursor';
import { must } from './test/must';
import { wordScore } from './test/word-scores';
import { firstWordBeat, nextWordBeat } from './word-nav';

const score = wordScore();
const id = (bar: number, beat: number) =>
  must(score.tracks[0]?.bars[bar]?.voices[0]?.beats[beat]).id;

describe('nextWordBeat', () => {
  it('goes through every beat, rests and empty beats included, for chords and text', () => {
    expect(nextWordBeat(score, id(0, 1), 'chord', 1)).toBe(id(0, 2));
    expect(nextWordBeat(score, id(0, 2), 'text', 1)).toBe(id(0, 3));
    expect(nextWordBeat(score, id(0, 3), 'chord', 1)).toBe(id(1, 0));
    expect(nextWordBeat(score, id(1, 0), 'chord', -1)).toBe(id(0, 3));
  });

  it('skips rests and empty beats for lyrics, across bars', () => {
    expect(nextWordBeat(score, id(0, 1), 'lyric', 1)).toBe(id(1, 0));
    expect(nextWordBeat(score, id(1, 0), 'lyric', -1)).toBe(id(0, 1));
  });

  it('stops at either end of the track', () => {
    expect(nextWordBeat(score, id(2, 3), 'chord', 1)).toBeUndefined();
    expect(nextWordBeat(score, id(0, 0), 'chord', -1)).toBeUndefined();
    expect(nextWordBeat(score, id(2, 3), 'lyric', 1)).toBeUndefined();
    expect(nextWordBeat(score, id(0, 0), 'lyric', -1)).toBeUndefined();
  });
});

describe('firstWordBeat', () => {
  const cursorOn = (bar: number, stop: number) =>
    must(cursorAtPosition(score, { track: 0, bar, voice: 0, stop }, { string: 1, staff: 'tab' }));

  it('is the cursor beat for a chord name, and nothing on an end slot', () => {
    expect(firstWordBeat(score, cursorOn(0, 2), 'chord')).toBe(id(0, 2));
    expect(firstWordBeat(score, { ...cursorOn(0, 3), beat: undefined }, 'chord')).toBeUndefined();
  });

  it('is the played beat at the onset for lyrics, else the next one', () => {
    expect(firstWordBeat(score, cursorOn(0, 1), 'lyric')).toBe(id(0, 1));
    expect(firstWordBeat(score, cursorOn(0, 2), 'lyric')).toBe(id(1, 0));
    expect(firstWordBeat(score, cursorOn(2, 3), 'lyric')).toBe(id(2, 3));
  });
});
