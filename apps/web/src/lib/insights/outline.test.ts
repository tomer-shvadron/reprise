import { PPQ } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { songOutline } from './outline';

describe('songOutline', () => {
  it('reads bars, passes, seconds, sections and key signatures', () => {
    const built = score()
      .tempo(120)
      .key(2)
      .track('guitar', { name: 'Lead' })
      .bar()
      .section('Intro')
      .repeatStart()
      .beat('1', [note(1, 0)])
      .bar()
      .repeatEnd(3)
      .beat('1', [note(1, 2)])
      .bar()
      .section('Verse')
      .beat('1', [note(1, 3)])
      .build();
    const outline = songOutline(built);
    expect(outline.bars.map((bar) => bar.passes)).toEqual([3, 3, 1]);
    expect(outline.bars[0]?.section).toBe('Intro');
    expect(outline.bars[1]?.section).toBeUndefined();
    expect(outline.bars[0]?.keySignature).toEqual({ fifths: 2, minor: false });
    // A 4/4 bar at 120 bpm is two seconds.
    expect(outline.bars[0]?.passSeconds).toBeCloseTo(2);
    expect(outline.bars[0]?.seconds).toBeCloseTo(6);
    expect(outline.bars[2]?.ticks).toBe(4 * PPQ);
    expect(outline.seconds).toBeCloseTo(14);
    expect(outline.tracks[0]).toMatchObject({ name: 'Lead', kind: 'fretted', capo: 0 });
  });

  it('lists a tempo change and a ramp once, however often a bar repeats', () => {
    const built = score()
      .tempo(100)
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0)])
      .bar()
      .repeatEnd(2)
      .tempo(140)
      .beat('1', [note(1, 0)])
      .build();
    const outline = songOutline(built);
    expect(outline.tempos.map(({ bar, startBpm }) => [bar, startBpm])).toEqual([
      [0, 100],
      [1, 140],
    ]);
    expect(outline.bars[1]?.tempo).toBe(140);
  });

  it('counts drum notes per instrument', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(36)])
      .beat('4', [midi(42)])
      .beat('4', [midi(36)])
      .beat('4', [midi(38)])
      .build();
    const drums = songOutline(built).tracks[0]?.drums;
    expect(drums?.notes).toBe(4);
    expect(drums?.top.map(({ name, count }) => [name, count])).toEqual([
      ['Bass Drum 1', 2],
      ['Acoustic Snare', 1],
      ['Closed Hi-Hat', 1],
    ]);
  });

  it('collects the chord names a file writes, skipping words that are not chords', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)], { chord: { name: 'Am' } })
      .beat('2', [note(1, 0)], { chord: { name: 'N.C.' } })
      .bar()
      .beat('1', [note(1, 0)], { chord: { name: 'F' } })
      .build();
    expect(songOutline(built).chords).toEqual([
      { bar: 0, onset: 0, name: 'Am', lastBar: 1 },
      { bar: 1, onset: 0, name: 'F', lastBar: 1 },
    ]);
  });

  it('survives a structured clone', () => {
    const outline = songOutline(
      score()
        .track('guitar')
        .bar()
        .beat('1', [note(1, 0)])
        .build(),
    );
    expect(structuredClone(outline)).toEqual(outline);
  });
});
