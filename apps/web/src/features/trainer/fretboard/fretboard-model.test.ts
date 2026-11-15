import { barTicks } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { boardOf, buildBeatIndex, dotsAt, dotsOfBeat, noteName } from './fretboard-model';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

describe('noteName', () => {
  it('spells pitch classes with sharps', () => {
    expect([40, 61, 71, 72].map(noteName)).toEqual(['E', 'C#', 'B', 'C']);
  });
});

describe('boardOf', () => {
  it('is undefined without strings and at least 24 frets otherwise', () => {
    const built = score()
      .tempo(120)
      .track('drums')
      .bar()
      .beat('4', [note(0, 38)])
      .build();
    expect(boardOf(built.tracks[0])).toBeUndefined();
    const guitar = score().tempo(120).track('guitar', { capo: 3 }).bar().build();
    expect(boardOf(guitar.tracks[0])).toEqual({ strings: 6, frets: 24, capo: 3 });
  });
});

describe('buildBeatIndex', () => {
  it('merges voices and drops rests', () => {
    const built = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(2, 0)])
      .build();
    const index = buildBeatIndex(must(built.tracks[0]), built.masterBars);
    const masterBar = must(built.masterBars[0]);
    const bar = masterBar.id;
    expect(dotsAt(index, bar, 0).map((dot) => dot.name)).toEqual(['E']);
    expect(dotsAt(index, bar, barTicks(masterBar) - 1).map((dot) => dot.name)).toEqual(['B']);
    const beat = must(must(must(built.tracks[0]).bars[0]).voices[0].beats[1]);
    expect(dotsOfBeat(index, beat.id).map((dot) => dot.string)).toEqual([2]);
  });
});

describe('per-tick update cost', () => {
  it('looks up a beat in far less than a frame on a large score', () => {
    const built = largeScore(1, 1000, { structure: true });
    const track = must(built.tracks[0]);
    const start = performance.now();
    const index = buildBeatIndex(track, built.masterBars);
    const build = performance.now() - start;
    const bars = built.masterBars.map((masterBar) => masterBar.id);
    const lookups = 100_000;
    const t0 = performance.now();
    let sink = 0;
    for (let i = 0; i < lookups; i++) {
      sink += dotsAt(index, must(bars[i % bars.length]), (i * 37) % 3840).length;
    }
    const per = (performance.now() - t0) / lookups;
    console.info(
      `fretboard: index ${String(built.masterBars.length)} bars in ${build.toFixed(1)} ms; lookup ${(per * 1000).toFixed(2)} us per tick`,
    );
    expect(sink).toBeGreaterThan(0);
    // A sanity bound at 1000x the reference lookup, nowhere near a 16 ms frame.
    expect(per).toBeLessThan(0.05);
  });
});
