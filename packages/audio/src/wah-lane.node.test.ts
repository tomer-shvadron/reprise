import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { createTimeline } from './timeline';
import { wahChangesInRange, wahLane, wahStateAt } from './wah-lane';

const BAR = PPQ * 4;
const closed = { effects: { wah: 'closed' as const } };
const open = { effects: { wah: 'open' as const } };

/** `[tick, state]` of the one track's lane. */
function points(song: ReturnType<ReturnType<typeof score>['build']>): [number, string][] {
  const lane = wahLane(createTimeline(song)).get(0) ?? [];
  return lane.map((p) => [p.tick, p.state]);
}

describe('wahLane', () => {
  it('rocks with the marks and ends at the first played note without one', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], closed)
      .beat('4', [note(1, 0)], open)
      .beat('4', [note(1, 0)], closed)
      .beat('4', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    expect(points(song)).toEqual([
      [0, 'closed'],
      [PPQ, 'open'],
      [2 * PPQ, 'closed'],
      [3 * PPQ, 'off'],
    ]);
  });

  it('keeps the wah through rests, empty beats and beats of tied notes only', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], open)
      .rest('4')
      .beat('4', [note(1, 0, { tie: true })])
      .beat('4', [])
      .bar()
      .beat('2', [note(1, 0)])
      .rest('2')
      .build();
    expect(points(song)).toEqual([
      [0, 'open'],
      [BAR, 'off'],
    ]);
  });

  it('lets a mark on a rest engage it', () => {
    const song = score()
      .track('guitar')
      .bar()
      .rest('2', closed)
      .beat('2', [note(1, 0)])
      .build();
    expect(points(song)).toEqual([
      [0, 'closed'],
      [2 * PPQ, 'off'],
    ]);
  });

  it('decides an onset in two voices by the mark, the lower voice first', () => {
    const marked = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .voice(1)
      .beat('1', [note(2, 0)], open)
      .voice(2)
      .beat('1', [note(3, 0)], closed)
      .build();
    expect(points(marked)).toEqual([[0, 'open']]);
    const unmarked = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    expect(wahLane(createTimeline(unmarked)).size).toBe(0);
  });

  it('carries the state across the passes of a repeat', () => {
    const song = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('4', [note(1, 0)], closed)
      .rest('4')
      .rest('2')
      .bar()
      .repeatEnd(2)
      .rest('1')
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    // Pass two meets the same mark with the pedal still closed: nothing to change.
    expect(points(song)).toEqual([
      [0, 'closed'],
      [4 * BAR, 'off'],
    ]);
  });

  it('ignores a track that is not fretted and a track with no mark', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .track('drums')
      .bar()
      .beat('1', [note(0, 36)], closed)
      .build();
    expect(wahLane(createTimeline(song)).size).toBe(0);
  });
});

describe('wahStateAt', () => {
  const song = score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 0)], open)
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 0)])
    .build();
  const timeline = createTimeline(song);

  it('is off outside a passage and the mark inside it', () => {
    expect(wahStateAt(timeline, 0, 0)).toBe('off');
    expect(wahStateAt(timeline, 0, PPQ - 1)).toBe('off');
    expect(wahStateAt(timeline, 0, PPQ)).toBe('open');
    expect(wahStateAt(timeline, 0, 2 * PPQ - 1)).toBe('open');
    expect(wahStateAt(timeline, 0, 2 * PPQ)).toBe('off');
    expect(wahStateAt(timeline, 0, BAR)).toBe('off');
  });

  it('is off for a track with no lane', () => {
    expect(wahStateAt(timeline, 5, PPQ)).toBe('off');
  });
});

describe('wahChangesInRange', () => {
  it('reports the changes in the window, from the run start up to the limit', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], closed)
      .beat('4', [note(1, 0)], open)
      .beat('4', [note(1, 0)], closed)
      .beat('4', [note(1, 0)])
      .build();
    const timeline = createTimeline(song);
    const ticks = (from: number, to: number, runStartTick: number, limitTick: number) =>
      wahChangesInRange(timeline, from, to, { runStartTick, limitTick }).map((w) => [
        w.tick,
        w.state,
      ]);
    expect(ticks(0, BAR, 0, BAR)).toHaveLength(4);
    expect(ticks(PPQ, 3 * PPQ, 0, BAR)).toEqual([
      [PPQ, 'open'],
      [2 * PPQ, 'closed'],
    ]);
    // Nothing before the run's start, nothing at or past the limit.
    expect(ticks(0, BAR, PPQ, 3 * PPQ)).toEqual([
      [PPQ, 'open'],
      [2 * PPQ, 'closed'],
    ]);
  });
});
