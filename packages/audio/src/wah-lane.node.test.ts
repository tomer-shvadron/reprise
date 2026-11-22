import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { createTimeline } from './timeline';
import { wahChangesInRange, wahLane, wahRestores, wahStateBefore } from './wah-lane';

const BAR = PPQ * 4;
const closed = { effects: { wah: 'closed' as const } };
const open = { effects: { wah: 'open' as const } };

/** `[tick, state]` of the one track's lane. */
function points_(song: ReturnType<ReturnType<typeof score>['build']>): [number, string][] {
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
    expect(points_(song)).toEqual([
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
    expect(points_(song)).toEqual([
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
    expect(points_(song)).toEqual([
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
    expect(points_(marked)).toEqual([[0, 'open']]);
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
    expect(points_(song)).toEqual([
      [0, 'closed'],
      [4 * BAR, 'off'],
    ]);
  });

  it('plays alternate endings and the repeat in playback order', () => {
    const song = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0)], closed)
      .bar()
      .volta([1])
      .repeatEnd(2)
      .beat('1', [note(1, 0)])
      .bar()
      .volta([2])
      .beat('1', [note(1, 0)])
      .build();
    const lane = wahLane(createTimeline(song)).get(0) ?? [];
    expect(lane.map((p) => [p.tick, p.state, p.passIndex, p.sequenceIndex])).toEqual([
      [0, 'closed', 0, 0],
      [BAR, 'off', 0, 1],
      [2 * BAR, 'closed', 1, 2],
      [3 * BAR, 'off', 0, 3],
    ]);
  });

  it('carries the state over a D.S. jump and ends it where the jump lands unmarked', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)], open)
      .bar()
      .target('segno')
      .beat('1', [note(1, 0)])
      .bar()
      .jump('dalSegno')
      .beat('1', [note(1, 0)], open)
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    const points = points_(song);
    // The ticks rise across the jump, one point per change, each in its own pass.
    expect(points.map(([, state]) => state)).toEqual(['open', 'off', 'open', 'off', 'open', 'off']);
    expect(points.map(([tick]) => tick)).toEqual(
      [...points.map(([tick]) => tick)].sort((a, b) => a - b),
    );
  });

  it("gives the grace notes before a beat the beat's state", () => {
    const grace = () => ({
      grace: [{ duration: 16 as const, before: true, notes: [note(1, 1)] }],
    });
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { ...closed, ...grace() })
      .beat('4', [note(1, 0)], grace())
      .beat('4', [note(1, 0)])
      .build();
    const sixteenth = PPQ / 4;
    // Engaged and ended a sixteenth early, where the graces sound.
    expect(points_(song)).toEqual([
      [PPQ - sixteenth, 'closed'],
      [2 * PPQ - sixteenth, 'off'],
    ]);
  });

  it('counts a tied note struck afresh after a repeat jump as a played note', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)], closed)
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0, { tie: true })])
      .bar()
      .repeatEnd(2)
      .rest('1')
      .build();
    // Pass one holds the tie from the bar before; after the jump back the tie has no origin
    // just before it, sounds as an onset, and ends the wah.
    expect(points_(song)).toEqual([
      [0, 'closed'],
      [3 * BAR, 'off'],
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

describe('wahRestores', () => {
  const song = score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 0)], open)
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 0)])
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .build();
  const timeline = createTimeline(song);
  const states = (tick: number) =>
    wahRestores(timeline, tick).map((r) => [r.trackIndex, r.state] as const);

  it('gives the state before the tick, the change on the tick coming through the window', () => {
    expect(states(0)).toEqual([[0, 'off']]);
    expect(states(PPQ)).toEqual([[0, 'off']]);
    expect(states(PPQ + 1)).toEqual([[0, 'open']]);
    expect(states(2 * PPQ)).toEqual([[0, 'open']]);
    expect(states(2 * PPQ + 1)).toEqual([[0, 'off']]);
  });

  it('names only the tracks that have a lane', () => {
    expect(wahRestores(timeline, 0).map((r) => r.trackIndex)).toEqual([0]);
    expect(wahStateBefore(timeline, 1, PPQ + 1)).toBe('off');
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
