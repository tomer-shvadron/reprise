import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { timelineOf } from '@/state/timeline';

import { extendRange, orderedRange } from './bar-range';
import { passIndexAt, runAround, seekTick, stepTick, trackOnsets } from './seek';

const BAR = 3840;

/** Bars of four quarters; `marks` sets repeats and voltas per bar index. */
function song(
  bars: number,
  marks: Record<number, { start?: true; end?: number; volta?: number[] }> = {},
): Score {
  const builder = score().track('guitar');
  for (let bar = 0; bar < bars; bar++) {
    builder.bar();
    const mark = marks[bar];
    if (mark?.start) builder.repeatStart();
    if (mark?.end) builder.repeatEnd(mark.end);
    if (mark?.volta) builder.volta(mark.volta);
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, beat)]);
  }
  return builder.build();
}

/** 1 2 3 4 1 2 3 4 5 6: runs [0–3] and [4–9]. */
const scoreA = () => song(6, { 0: { start: true }, 3: { end: 2 } });
/** 1 2 3 1 2 4 5: bar 3 is volta 1, bar 4 volta 2. */
const scoreB = () => song(5, { 0: { start: true }, 2: { volta: [1], end: 2 }, 3: { volta: [2] } });

const startOf = (s: Score, index: number) => timelineOf(s).map.passes[index]?.startTick ?? -1;

describe('the pass a click seeks to', () => {
  it('splits the sequence into runs of consecutive bars', () => {
    const { passes } = timelineOf(scoreA()).map;
    expect(passes.map((pass) => pass.masterBarIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4, 5]);
    expect(runAround(passes, 2)).toEqual({ start: 0, end: 3 });
    expect(runAround(passes, 6)).toEqual({ start: 4, end: 9 });
  });

  it('stays in the current run, else takes the next after, else the last before', () => {
    const a = scoreA();
    const t = timelineOf(a);
    const seek = (from: number, bar: number) =>
      seekTick(t, { masterBarIndex: bar, tick: 0 }, startOf(a, from));
    expect(seek(2, 1)).toBe(startOf(a, 1));
    expect(seek(6, 1)).toBe(startOf(a, 5));
    expect(seek(1, 4)).toBe(startOf(a, 8));
    expect(seek(9, 1)).toBe(startOf(a, 5));

    const b = scoreB();
    const tb = timelineOf(b);
    expect(tb.map.passes.map((pass) => pass.masterBarIndex)).toEqual([0, 1, 2, 0, 1, 3, 4]);
    expect(seekTick(tb, { masterBarIndex: 2, tick: 0 }, startOf(b, 6))).toBe(startOf(b, 2));
    expect(seekTick(t, { masterBarIndex: 9, tick: 0 }, 0)).toBeUndefined();
  });

  it('keeps the tick inside the pass', () => {
    const a = scoreA();
    expect(seekTick(timelineOf(a), { masterBarIndex: 1, tick: 960 }, 0)).toBe(BAR + 960);
    expect(seekTick(timelineOf(a), { masterBarIndex: 1, tick: 99_999 }, 0)).toBeCloseTo(2 * BAR);
  });

  it('with a loop, prefers the passes inside it', () => {
    const a = scoreA();
    const t = timelineOf(a);
    const firstLoop = { startTick: startOf(a, 1), endTick: startOf(a, 3) };
    const secondLoop = { startTick: startOf(a, 5), endTick: startOf(a, 7) };
    const seek = (from: number, bar: number, loop: typeof firstLoop) =>
      seekTick(t, { masterBarIndex: bar, tick: 0 }, startOf(a, from), loop);
    expect(seek(1, 1, firstLoop)).toBe(startOf(a, 1));
    expect(seek(6, 2, secondLoop)).toBe(startOf(a, 6));
    expect(seek(6, 4, secondLoop)).toBe(startOf(a, 8));
  });
});

describe('keyboard steps', () => {
  const a = scoreA();
  const t = timelineOf(a);
  const stopped = { running: false, trackIndex: 0 };
  const running = { running: true, trackIndex: 0 };

  it('step through beats in playback order', () => {
    expect(passIndexAt(t, 2 * BAR + 100)).toBe(2);
    expect(stepTick(t, 100, 'nextBeat', stopped)).toBe(960);
    expect(stepTick(t, 1000, 'previousBeat', stopped)).toBe(960);
    expect(stepTick(t, 960, 'previousBeat', stopped)).toBe(0);
    expect(stepTick(t, 1000, 'previousBeat', running)).toBe(0);
    expect(stepTick(t, 3 * BAR + 2880, 'nextBeat', stopped)).toBe(startOf(a, 4));
    expect(stepTick(t, startOf(a, 4), 'previousBeat', stopped)).toBe(3 * BAR + 2880);
    expect(stepTick(t, 0, 'previousBeat', stopped)).toBeUndefined();
  });

  it('step through bars, to the bar start, and to the first and last bar', () => {
    const last = startOf(a, 9);
    expect(stepTick(t, last + 100, 'nextBar', stopped)).toBeUndefined();
    expect(stepTick(t, 3 * BAR + 100, 'previousBar', stopped)).toBe(3 * BAR);
    expect(stepTick(t, 3 * BAR + 100, 'previousBar', running)).toBe(2 * BAR);
    expect(stepTick(t, 3 * BAR + 100, 'nextBar', running)).toBe(4 * BAR);
    expect(stepTick(t, 3 * BAR + 100, 'barStart', stopped)).toBe(3 * BAR);
    expect(stepTick(t, 3 * BAR, 'barStart', stopped)).toBeUndefined();
    expect(stepTick(t, 3 * BAR, 'firstBar', stopped)).toBe(0);
    expect(stepTick(t, 0, 'lastBar', stopped)).toBe(last);
  });

  it('stop at the first voice’s onsets, or every voice’s, or the bar start', () => {
    const multi = score()
      .track('guitar')
      .bar()
      .voice(1)
      .beat('2', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .voice(2)
      .beat('4', [note(2, 0)])
      .beat('2.', [note(2, 0)])
      .bar()
      .build();
    expect(trackOnsets(multi, 0, 0)).toEqual([0, 960, 1920, 2880]);
    expect(trackOnsets(multi, 0, 1)).toEqual([0]);
    expect(trackOnsets(scoreA(), 0, 0)).toEqual([0, 960, 1920, 2880]);
  });
});

describe('bar ranges', () => {
  const a = scoreA();
  const id = (index: number) => a.masterBars[index]?.id ?? '';

  it('orders and extends ranges away from the anchor, clamped to the score', () => {
    expect(orderedRange(a, id(3), id(1))).toEqual({ startBar: id(1), endBar: id(3) });
    expect(extendRange(a, undefined, id(2), 1)).toEqual({ startBar: id(2), endBar: id(3) });
    const range = { startBar: id(2), endBar: id(3) };
    expect(extendRange(a, range, id(2), -1)).toEqual({ startBar: id(2), endBar: id(2) });
    expect(extendRange(a, { startBar: id(0), endBar: id(2) }, id(2), -1)).toEqual({
      startBar: id(0),
      endBar: id(2),
    });
    expect(extendRange(a, { startBar: id(4), endBar: id(5) }, id(4), 1)).toEqual({
      startBar: id(4),
      endBar: id(5),
    });
  });
});
