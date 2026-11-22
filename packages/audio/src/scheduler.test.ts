import { describe, expect, it } from 'vitest';

import { PPQ, secondsAtTick } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import type { ScoreBuilder } from '@reprise/model/testing';

import { advance, retime, startRun, tickAtTime, timeAtTick } from './scheduler';
import type { Advanced, Pace, Run, ScheduledNote } from './scheduler';
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
    const run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
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

  it('plays every beat of an over-full bar once, on time, and starts the next bar after it', () => {
    let builder = score().tempo(120).track('guitar').bar();
    for (let fret = 0; fret < 6; fret++) builder = builder.beat('4', [note(1, fret)]);
    builder = builder.bar();
    for (let fret = 0; fret < 4; fret++) builder = builder.beat('4', [note(2, fret)]);
    const timeline = createTimeline(builder.build({ validate: false }));
    const run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
    const { run: end, notes } = walk(timeline, run, 20);

    expect(notes.map((n) => [n.note.string, n.note.fret])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    for (const [index, scheduled] of notes.entries()) {
      expect(scheduled.when).toBeCloseTo(index * 0.5, 9);
    }
    expect(end.finished).toBe(true);
    expect(end.endTime).toBeCloseTo(5, 9);
  });

  it('hands out both sides of the repeat in one window that spans it', () => {
    const timeline = repeated();
    const run = startRun(timeline, {
      tick: 7 * PPQ,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
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
    let run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop,
      countIn: false,
    });
    const crossings: { pass: number; when: number }[] = [];
    const notes: ScheduledNote[] = [];
    for (let now = 0; now < 7.9; now += 0.025) {
      for (;;) {
        const result = advance(timeline, run, { now, horizon: now + 0.2, metronome: false });
        run = result.run;
        notes.push(...result.notes);
        if (!result.loop) break;
        crossings.push(result.loop);
        if (result.loop.pass === 1) run = retime(timeline, run, { kind: 'scaled', rate: 2 });
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
    const run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
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
    const run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
    const late = advance(timeline, run, { now: 0.3, horizon: 0.6, metronome: false });

    expect(late.mixes.map((m) => [m.tick, m.when, m.mix.volume?.value])).toEqual([[0, 0.3, 20]]);
    expect(late.notes.map((n) => n.when)).toEqual([0.5]);
  });

  it('plays the count-in clicks before the first note', () => {
    const timeline = repeated();
    const run = startRun(timeline, {
      tick: 0,
      time: 1,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: true,
    });
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

/** Bar 1 at 60 BPM, bar 2 at 120, quarter notes whose fret is the bar index. */
function twoTempos(): Timeline {
  let builder = score().tempo(60).track('guitar').bar();
  builder = quarters(builder, 0).bar().tempo(120);
  return createTimeline(quarters(builder, 1).build());
}

const fixed = (bpm: number): Pace => ({ kind: 'fixed', bpm });
const start = (
  timeline: Timeline,
  pace: Pace,
  extra: Partial<Parameters<typeof startRun>[1]> = {},
) => startRun(timeline, { tick: 0, time: 0, pace, loop: undefined, countIn: false, ...extra });

describe('fixed pace', () => {
  it('plays every tick at one BPM, whatever the tempo map says', () => {
    const timeline = twoTempos();
    const { notes, run } = walk(timeline, start(timeline, fixed(90)), 20);

    expect(notes).toHaveLength(8);
    for (const [index, scheduled] of notes.entries()) {
      expect(scheduled.when).toBeCloseTo(index * (2 / 3), 9);
      expect(scheduled.duration).toBeCloseTo(2 / 3, 9);
    }
    expect(run.endTime).toBeCloseTo(8 * (2 / 3), 9);
  });

  it('still follows the map when the pace is scaled', () => {
    const timeline = twoTempos();
    const { notes } = walk(timeline, start(timeline, { kind: 'scaled', rate: 1 }), 20);
    expect(notes.map((n) => n.when)).toEqual([0, 1, 2, 3, 4, 4.5, 5, 5.5]);
  });

  it('keeps the pace across a loop wrap', () => {
    const timeline = twoTempos();
    const loop = { startTick: BAR, endTick: 2 * BAR };
    let run = start(timeline, fixed(120), { tick: BAR, loop });
    const crossings: { pass: number; when: number }[] = [];
    const whens: number[] = [];
    for (let now = 0; now < 5.9; now += 0.025) {
      for (;;) {
        const result = advance(timeline, run, { now, horizon: now + 0.2, metronome: false });
        run = result.run;
        whens.push(...result.notes.map((n) => n.when));
        if (!result.loop) break;
        crossings.push(result.loop);
      }
    }
    // The loop bar plays 2 s at a fixed 120; the map alone would give the first bar 4 s.
    expect(crossings.map((c) => c.when)).toEqual([2, 4, 6]);
    expect(whens.slice(0, 6)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it('starts at a seek target on the fixed grid', () => {
    const timeline = twoTempos();
    const { notes } = walk(timeline, start(timeline, fixed(90), { tick: 2 * PPQ, time: 1 }), 20);
    expect(notes.map((n) => n.note.fret)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(notes[0]?.when).toBeCloseTo(1, 9);
    expect(notes[1]?.when).toBeCloseTo(1 + 2 / 3, 9);
  });

  it('spaces the count-in clicks at the fixed BPM', () => {
    const timeline = twoTempos();
    const run = start(timeline, fixed(120), { time: 1, countIn: true });
    const result = advance(timeline, run, { now: 0, horizon: 3.2, metronome: false });
    expect(result.clicks.map((c) => c.when)).toEqual([1, 1.5, 2, 2.5]);
    expect(result.notes[0]?.when).toBe(3);
  });

  it('re-anchors from scaled to fixed and back without moving what was handed out', () => {
    const timeline = twoTempos();
    let run = start(timeline, { kind: 'scaled', rate: 1 });
    const first = advance(timeline, run, { now: 0, horizon: 1.2, metronome: false });
    expect(first.notes.map((n) => n.when)).toEqual([0, 1]);
    run = retime(timeline, first.run, fixed(120));
    const second = advance(timeline, run, { now: 1.2, horizon: 2.5, metronome: false });
    // The cursor sat at 1.2 s, tick 1.2 quarters; the next quarter is 0.8 quarter later.
    expect(second.notes.map((n) => n.when)[0]).toBeCloseTo(1.6, 9);
    expect(second.notes.map((n) => n.when)[1]).toBeCloseTo(2.1, 9);
    run = retime(timeline, second.run, { kind: 'scaled', rate: 1 });
    expect(run.anchor.pace).toEqual({ kind: 'scaled', rate: 1 });
  });

  it('maps time to ticks and back, clamping at the end', () => {
    const timeline = twoTempos();
    const anchor = { time: 0, tick: 0, pace: fixed(120) };
    expect(tickAtTime(timeline, anchor, 0.5)).toBeCloseTo(PPQ, 9);
    expect(timeAtTick(timeline, anchor, 3 * PPQ)).toBeCloseTo(1.5, 9);
    expect(tickAtTime(timeline, anchor, 1000)).toBe(timeline.endTick);
    expect(tickAtTime(timeline, anchor, -1)).toBe(0);
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
    const run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
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
    let run = startRun(timeline, {
      tick: 0,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop,
      countIn: false,
    });
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

describe('mixer changes', () => {
  /** Bar 0 glides the volume and steps the pan on rests; bars 1 and 2 are quarter notes. */
  function mixed(): Timeline {
    let builder = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .rest('4', { mix: { volume: { value: 40, duration: 2 } } })
      .rest('4', { mix: { pan: { value: 20 } } })
      .rest('2')
      .bar();
    builder = quarters(builder, 1).bar();
    return createTimeline(quarters(builder, 2).build());
  }

  it('replays the changes before the start point at the run start, settled, and only once', () => {
    const timeline = mixed();
    const run = startRun(timeline, {
      tick: BAR,
      time: 1,
      pace: { kind: 'scaled', rate: 1 },
      loop: undefined,
      countIn: false,
    });
    const first = advance(timeline, run, { now: 0.5, horizon: 1.1, metronome: false });
    const second = advance(timeline, first.run, { now: 0.6, horizon: 1.5, metronome: false });

    expect(first.mixes.map((m) => [m.tick, m.when, m.mix])).toEqual([
      [0, 1, { volume: { value: 40 } }],
      [PPQ, 1, { pan: { value: 20 } }],
    ]);
    for (const mix of first.mixes) expect(mix.secondsPerTick).toBeCloseTo(0.5 / PPQ, 12);
    expect(second.mixes).toEqual([]);
  });

  it('replays them again at each loop wrap, timed at the wrap', () => {
    const timeline = mixed();
    const loop = { startTick: BAR, endTick: 2 * BAR };
    const run = startRun(timeline, {
      tick: BAR,
      time: 0,
      pace: { kind: 'scaled', rate: 1 },
      loop,
      countIn: false,
    });
    const whens: number[] = [];
    walk(timeline, run, 5, (_, result) => whens.push(...result.mixes.map((m) => m.when)));

    expect(whens.map((when) => Math.round(when * 1e6) / 1e6)).toEqual([0, 0, 2, 2, 4, 4]);
  });
});
