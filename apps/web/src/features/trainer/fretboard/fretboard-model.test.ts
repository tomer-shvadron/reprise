import { barTicks } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { boardOf, createBeatIndex, dotLabel, noteName } from './fretboard-model';

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

describe('createBeatIndex', () => {
  const built = score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('2', [note(1, 0)])
    .beat('2', [note(2, 0)])
    .bar()
    .beat('1', [note(3, 0)])
    .build();
  const track = must(built.tracks[0]);
  const first = must(built.masterBars[0]);
  const second = must(built.masterBars[1]);

  it('merges voices and drops rests', () => {
    const index = createBeatIndex(track, built.masterBars);
    expect(index.dotsAt(first.id, 0).map((dot) => dot.name)).toEqual(['E']);
    expect(index.dotsAt(first.id, barTicks(first) - 1).map((dot) => dot.name)).toEqual(['B']);
    const beat = must(must(track.bars[0]).voices[0].beats[1]);
    expect(index.dotsOfBeat(first.id, beat.id).map((dot) => dot.string)).toEqual([2]);
  });

  it('recomputes only an edited bar and nothing for a mixer change', () => {
    const before = createBeatIndex(track, built.masterBars);
    const one = before.dotsAt(first.id, 0);
    const two = before.dotsAt(second.id, 0);
    // A mixer change replaces the track object and keeps its bars.
    const mixed = { ...track, channel: { ...track.channel, volume: 10 } };
    const afterMix = createBeatIndex(mixed, built.masterBars);
    expect(afterMix.dotsAt(first.id, 0)).toBe(one);
    expect(afterMix.dotsAt(second.id, 0)).toBe(two);
    // An edit replaces one bar object.
    const edited = { ...track, bars: track.bars.map((bar, i) => (i === 0 ? { ...bar } : bar)) };
    const afterEdit = createBeatIndex(edited, built.masterBars);
    expect(afterEdit.dotsAt(second.id, 0)).toBe(two);
    expect(afterEdit.dotsAt(first.id, 0)).not.toBe(one);
    expect(afterEdit.dotsAt(first.id, 0).map((dot) => dot.name)).toEqual(['E']);
  });
});

describe('dots', () => {
  const dotsOf = (spec: Parameters<typeof note>[2], string = 1, fret = 0, capo = 0) => {
    const built = score()
      .tempo(120)
      .track('guitar', { capo })
      .bar()
      .beat('4', [note(string, fret, spec)])
      .build();
    const masterBar = must(built.masterBars[0]);
    return createBeatIndex(must(built.tracks[0]), built.masterBars).dotsAt(masterBar.id, 0);
  };

  it('labels a dead note without a pitch', () => {
    expect(dotsOf({ dead: true }, 3, 5).map(dotLabel)).toEqual(['string 3, fret 5, dead note']);
  });

  it('names a natural harmonic by the pitch it sounds', () => {
    // The fret 12 node on the open high E sounds E; the 7 node on the A string sounds E, not the fifth.
    expect(dotsOf({ harmonic: { kind: 'natural' } }, 5, 7).map(dotLabel)).toEqual([
      'string 5, fret 7, harmonic E',
    ]);
  });

  it('says where a capoed note sits', () => {
    expect(dotsOf({}, 1, 0, 2).map(dotLabel)).toEqual(['string 1, fret 2 (capo 2, written 0), F#']);
  });
});

describe('boardOf frets', () => {
  it('reaches the highest position used and honours a fretCount above 24', () => {
    const high = score()
      .tempo(120)
      .track('guitar', { capo: 5 })
      .bar()
      .beat('4', [note(1, 22)])
      .build();
    expect(boardOf(high.tracks[0])?.frets).toBe(27);
    const long = score().tempo(120).track('guitar', { fretCount: 30 }).bar().build();
    expect(boardOf(long.tracks[0])?.frets).toBe(30);
  });
});

describe('per-tick lookup cost', () => {
  it('looks up a beat in far less than a frame on a large score', () => {
    const big = largeScore(1, 1000, { structure: true });
    const index = createBeatIndex(must(big.tracks[0]), big.masterBars);
    const bars = big.masterBars.map((masterBar) => masterBar.id);
    // Warm the lazy cache: the first tick in a bar pays for it once.
    for (const id of bars) index.dotsAt(id, 0);
    const lookups = 100_000;
    const start = performance.now();
    let sink = 0;
    for (let i = 0; i < lookups; i++) {
      sink += index.dotsAt(must(bars[i % bars.length]), (i * 37) % 3840).length;
    }
    const per = (performance.now() - start) / lookups;
    expect(sink).toBeGreaterThan(0);
    // The reference machine measures about 0.1 us per lookup; this bound is 50x that, a
    // sanity check far below the 16 ms of a frame, not a budget.
    expect(per).toBeLessThan(0.005);
  });
});
