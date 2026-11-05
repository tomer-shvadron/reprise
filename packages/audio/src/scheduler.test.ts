import { describe, expect, it } from 'vitest';

import { PPQ, secondsAtTick } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import type { ScoreBuilder } from '@reprise/model/testing';

import { advance, retime, startRun } from './scheduler';
import type { Advanced, Run, ScheduledNote } from './scheduler';
import { createTimeline } from './timeline';
import type { Timeline } from './timeline';

const BAR = PPQ * 4;

function quarters(builder: ScoreBuilder, fret: number): ScoreBuilder {
  return builder
    .beat('4', [note(1, fret)])
    .beat('4', [note(1, fret)])
    .beat('4', [note(1, fret)])
    .beat('4', [note(1, fret)]);
}

/** `|: bar 0 | bar 1 :| bar 2`, quarter notes whose fret is the bar index. */
function repeated(): Timeline {
  let builder = score().tempo(120).track('guitar').bar().repeatStart();
  builder = quarters(builder, 0).bar().repeatEnd(2);
  builder = quarters(builder, 1).bar();
  return createTimeline(quarters(builder, 2).build());
}

/** Calls `advance` the way the 25 ms timer would, until the run finishes or `until`. */
function walk(
  timeline: Timeline,
  run: Run,
  until: number,
  onStep?: (now: number, result: Advanced) => void,
): { run: Run; notes: (ScheduledNote & { now: number })[] } {
  const notes: (ScheduledNote & { now: number })[] = [];
  let current = run;
  for (let now = 0; now < until && !current.finished; now += 0.025) {
    for (;;) {
      const result = advance(timeline, current, { now, horizon: now + 0.2, metronome: false });
      current = result.run;
      notes.push(...result.notes.map((n) => ({ ...n, now })));
      onStep?.(now, result);
      if (!result.loop) break;
    }
  }
  return { run: current, notes };
}

describe('advance', () => {
  it('walks the horizon across a repeat boundary, each note exactly once and on time', () => {
    const timeline = repeated();
    const run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop: undefined, countIn: false });
    const { run: end, notes } = walk(timeline, run, 20);

    expect(notes.map((n) => n.note.fret)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    ]);
    for (const [index, scheduled] of notes.entries()) {
      expect(scheduled.when).toBeCloseTo(index * 0.5, 9);
      expect(scheduled.tick).toBeCloseTo(index * PPQ, 6);
      expect(scheduled.when).toBeGreaterThanOrEqual(scheduled.now);
      expect(scheduled.when).toBeLessThan(scheduled.now + 0.2);
    }
    expect(notes.map((n) => n.sequenceIndex)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
    expect(end.finished).toBe(true);
    expect(end.endTime).toBeCloseTo(10, 9);
  });

  it('hands out both sides of the repeat in one window that spans it', () => {
    const timeline = repeated();
    const run = startRun(timeline, {
      tick: 7 * PPQ,
      time: 0,
      rate: 1,
      loop: undefined,
      countIn: false,
    });
    const { notes } = advance(timeline, run, { now: 0, horizon: 0.6, metronome: false });

    expect(notes.map((n) => [n.sequenceIndex, n.note.fret, n.when])).toEqual([
      [1, 1, 0],
      [2, 0, 0.5],
    ]);
  });

  it('wraps a loop seamlessly and stops after the wrap so a tempo change lands on it', () => {
    const timeline = repeated();
    const loop = { startTick: BAR, endTick: 2 * BAR };
    let run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop, countIn: false });
    const crossings: { pass: number; when: number }[] = [];
    const notes: ScheduledNote[] = [];
    for (let now = 0; now < 7.9; now += 0.025) {
      for (;;) {
        const result = advance(timeline, run, { now, horizon: now + 0.2, metronome: false });
        run = result.run;
        notes.push(...result.notes);
        if (!result.loop) break;
        crossings.push(result.loop);
        if (result.loop.pass === 1) run = retime(timeline, run, 2);
      }
    }

    expect(crossings).toEqual([
      { pass: 1, when: 4 },
      { pass: 2, when: 8 },
    ]);
    expect(notes.map((n) => n.when)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8]);
    expect(notes.slice(4).map((n) => n.note.fret)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('moves a slightly late event to now and drops one later than the tolerance', () => {
    const timeline = repeated();
    const run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop: undefined, countIn: false });
    const late = advance(timeline, run, { now: 0.52, horizon: 0.72, metronome: false });

    expect(late.notes.map((n) => [n.tick, n.when])).toEqual([[PPQ, 0.52]]);
    expect(late.notes[0]?.duration).toBeCloseTo(0.48, 9);
  });

  it('applies a mixer change handed out late from now instead of dropping it', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .rest('4', { mix: { volume: { value: 20 } } })
      .beat('4', [note(1, 0)])
      .rest('2')
      .build();
    const timeline = createTimeline(song);
    const run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop: undefined, countIn: false });
    const late = advance(timeline, run, { now: 0.3, horizon: 0.6, metronome: false });

    expect(late.mixes.map((m) => [m.tick, m.when, m.mix.volume?.value])).toEqual([[0, 0.3, 20]]);
    expect(late.notes.map((n) => n.when)).toEqual([0.5]);
  });

  it('plays the count-in clicks before the first note', () => {
    const timeline = repeated();
    const run = startRun(timeline, { tick: 0, time: 1, rate: 1, loop: undefined, countIn: true });
    const result = advance(timeline, run, { now: 0, horizon: 3.2, metronome: false });

    expect(result.clicks).toEqual([
      { when: 1, accent: true, countIn: true },
      { when: 1.5, accent: false, countIn: true },
      { when: 2, accent: false, countIn: true },
      { when: 2.5, accent: false, countIn: true },
    ]);
    expect(result.notes.map((n) => n.when)).toEqual([3]);
  });
});

describe('drift', () => {
  it('keeps every onset on the tempo map across 300 structured bars, each note once', () => {
    const song = largeScore(8, 300, { structure: true });
    const timeline = createTimeline(song);
    let expected = 0;
    for (const pass of timeline.map.passes) {
      for (const track of song.tracks) {
        for (const voice of track.bars[pass.masterBarIndex]?.voices ?? []) {
          for (const beat of voice.beats) if (!beat.rest) expected += beat.notes.length;
        }
      }
    }
    const run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop: undefined, countIn: false });
    const { run: end, notes } = walk(timeline, run, 10_000);

    // 596 passes (repeats every 8 bars), tempo marks every 16, a 3/4 bar every fifth.
    expect(timeline.map.passes.length).toBeGreaterThan(300);
    expect(notes).toHaveLength(expected);
    let drift = 0;
    for (const scheduled of notes) {
      drift = Math.max(
        drift,
        Math.abs(scheduled.when - secondsAtTick(timeline.map, scheduled.tick)),
      );
      expect(scheduled.when).toBeGreaterThanOrEqual(scheduled.now);
    }
    expect(drift).toBeLessThan(1e-9);
    expect(end.finished).toBe(true);
    expect(end.endTime).toBeCloseTo(timeline.map.durationSeconds, 9);
  });

  it('keeps a loop on the grid over 300 wraps', () => {
    const timeline = createTimeline(largeScore(1, 2));
    const loop = { startTick: 0, endTick: 2 * BAR };
    const passSeconds = 4;
    let run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop, countIn: false });
    let wraps = 0;
    let drift = 0;
    for (let now = 0; wraps < 300; now += 0.025) {
      for (;;) {
        const result = advance(timeline, run, { now, horizon: now + 0.2, metronome: false });
        run = result.run;
        for (const scheduled of result.notes) {
          const inPass = scheduled.tick - loop.startTick;
          const ideal = run.loopPasses * passSeconds + secondsAtTick(timeline.map, inPass);
          drift = Math.max(drift, Math.abs(scheduled.when - ideal));
        }
        if (!result.loop) break;
        wraps += 1;
        drift = Math.max(drift, Math.abs(result.loop.when - wraps * passSeconds));
      }
    }

    expect(run.loopPasses).toBe(300);
    expect(drift).toBeLessThan(1e-9);
  });
});
