import { midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { songOutline } from './outline';
import { songShape } from './shape';

describe('songShape', () => {
  const built = score()
    .tempo(120)
    .key(1)
    .track('piano')
    .bar()
    .section('Intro')
    .repeatStart()
    .beat('1', [midi(60)])
    .bar()
    .repeatEnd(2)
    .beat('1', [midi(62)])
    .bar()
    .section('Verse')
    .timeSignature(3, 4)
    .key(0)
    .tempo(90)
    .beat('2.', [midi(64)])
    .bar()
    .beat('2.', [midi(65)])
    .build();
  const shape = songShape(songOutline(built));

  it('counts the bars written and played, and the length at the written tempo', () => {
    expect(shape.barsWritten).toBe(4);
    expect(shape.barsPlayed).toBe(6);
    // The two 4/4 bars at 120 bpm play twice, 8 s, two 3/4 bars at 90 bpm are 4 s.
    expect(shape.seconds).toBeCloseTo(8 + 4);
  });

  it('gives the tempo at the start, its range and each change', () => {
    expect(shape.tempo.start).toBe(120);
    expect(shape.tempo.min).toBe(90);
    expect(shape.tempo.max).toBe(120);
    expect(shape.tempo.changes).toEqual([{ bar: 2, startBpm: 90, endBpm: 90, ramp: false }]);
  });

  it('lists time signatures and key signatures with their bar ranges', () => {
    expect(shape.timeSignatures).toEqual([
      { numerator: 4, denominator: 4, fromBar: 0, toBar: 1 },
      { numerator: 3, denominator: 4, fromBar: 2, toBar: 3 },
    ]);
    expect(shape.keySignatures).toEqual([
      { fifths: 1, minor: false, fromBar: 0, toBar: 1 },
      { fifths: 0, minor: false, fromBar: 2, toBar: 3 },
    ]);
  });

  it('gives each section its bars and its seconds, repeats counted', () => {
    expect(shape.sections).toEqual([
      { name: 'Intro', fromBar: 0, toBar: 1, seconds: expect.closeTo(8) as number },
      { name: 'Verse', fromBar: 2, toBar: 3, seconds: expect.closeTo(4) as number },
    ]);
  });

  it('marks a ramp and keeps one tempo for a song that never changes', () => {
    const ramped = score()
      .tempo(100)
      .track('piano')
      .bar()
      .beat('4', [midi(60)], { mix: { tempo: { bpm: 140, duration: 4 } } })
      .beat('4', [midi(60)])
      .beat('4', [midi(60)])
      .beat('4', [midi(60)])
      .bar()
      .beat('1', [midi(60)])
      .build();
    const { tempo } = songShape(songOutline(ramped));
    expect(tempo.start).toBe(100);
    expect(tempo.max).toBe(140);
    expect(tempo.changes.some((change) => change.ramp)).toBe(true);
    const steady = songShape(
      songOutline(
        score()
          .tempo(80)
          .track('piano')
          .bar()
          .beat('1', [midi(60)])
          .build(),
      ),
    );
    expect(steady.tempo).toEqual({ start: 80, min: 80, max: 80, changes: [] });
  });
});
