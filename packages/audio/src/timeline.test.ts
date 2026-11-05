import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { clicksInRange, countInTicks, createTimeline, loopRange, notesInRange } from './timeline';

const BAR = PPQ * 4;

describe('notesInRange', () => {
  it('folds a tie across a bar line into its origin', () => {
    const tied = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 5)])
      .bar()
      .beat('2', [note(1, 5, { tie: true })])
      .beat('2', [note(1, 7)])
      .build();
    const timeline = createTimeline(tied);
    const onsets = notesInRange(timeline, 0, 2 * BAR, { runStartTick: 0, limitTick: 2 * BAR });

    expect(onsets.map((o) => [o.tick, o.durationTicks, o.note.fret])).toEqual([
      [0, 2 * PPQ, 0],
      [2 * PPQ, 4 * PPQ, 5],
      [6 * PPQ, 2 * PPQ, 7],
    ]);
  });

  it('sounds a tied note when playback starts on it', () => {
    const tied = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 5)])
      .beat('2', [note(1, 5, { tie: true })])
      .build();
    const timeline = createTimeline(tied);
    const onsets = notesInRange(timeline, 2 * PPQ, BAR, { runStartTick: 2 * PPQ, limitTick: BAR });

    expect(onsets.map((o) => [o.tick, o.durationTicks])).toEqual([[2 * PPQ, 2 * PPQ]]);
  });

  it('skips rests and clips durations to the limit', () => {
    const bars = score()
      .track('guitar')
      .bar()
      .rest('2')
      .beat('2', [note(1, 3)])
      .build();
    const onsets = notesInRange(createTimeline(bars), 0, BAR, {
      runStartTick: 0,
      limitTick: 3 * PPQ,
    });

    expect(onsets.map((o) => [o.tick, o.durationTicks])).toEqual([[2 * PPQ, PPQ]]);
  });
});

describe('clicks and count-in', () => {
  it('accents the downbeat of each 4/4 bar', () => {
    const plain = score().track('guitar').bar().rest('1').bar().rest('1').build();
    const clicks = clicksInRange(createTimeline(plain), 0, 2 * BAR);

    expect(clicks.map((c) => [c.tick / PPQ, c.accent])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
    ]);
  });

  it('aligns an anacrusis to the end of its bar and shortens the count-in by it', () => {
    const pickup = score()
      .track('guitar')
      .bar()
      .anacrusis()
      .beat('4', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 2)])
      .build();
    const timeline = createTimeline(pickup);

    expect(clicksInRange(timeline, 0, PPQ)).toEqual([{ tick: 0, accent: false }]);
    expect(countInTicks(timeline, 0)).toEqual({ ticks: 3 * PPQ, unit: PPQ });
    expect(countInTicks(timeline, PPQ)).toEqual({ ticks: BAR, unit: PPQ });
  });

  it('counts eighths in 6/8', () => {
    const compound = score().timeSignature(6, 8).track('guitar').bar().rest('2.').build();

    expect(countInTicks(createTimeline(compound), 0)).toEqual({ ticks: 3 * PPQ, unit: PPQ / 2 });
  });
});

describe('loopRange', () => {
  it('picks the pass of a repeated bar nearest the playhead', () => {
    const repeated = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .rest('1')
      .bar()
      .repeatEnd(2)
      .rest('1')
      .bar()
      .rest('1')
      .build();
    const timeline = createTimeline(repeated);
    const [first, second] = repeated.masterBars;
    if (!first || !second) throw new Error('fixture');
    const range = { startBar: first.id, endBar: second.id };

    expect(loopRange(timeline, range, 0)).toEqual({ startTick: 0, endTick: 2 * BAR });
    expect(loopRange(timeline, range, 2.5 * BAR)).toEqual({ startTick: 2 * BAR, endTick: 4 * BAR });
    expect(() => loopRange(timeline, { startBar: second.id, endBar: first.id }, 0)).toThrow(
      RangeError,
    );
  });
});
