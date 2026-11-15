import { describe, expect, it } from 'vitest';

import { manualTicker } from './offline-driver';
import { RecordingSink } from './recording-sink';
import { DEFAULT_CLICK_SETTINGS, createStandaloneClick } from './standalone-click';
import type { ClickSettings } from './standalone-click';

const settings = (partial: Partial<ClickSettings> = {}): ClickSettings => ({
  ...DEFAULT_CLICK_SETTINGS,
  ...partial,
});

function setup() {
  const clock = { currentTime: 0 };
  const sink = new RecordingSink(clock);
  const scheduler = manualTicker();
  const click = createStandaloneClick({
    context: clock,
    sink,
    scheduler: scheduler.ticker,
    lookahead: 0.2,
    startLatency: 0.1,
  });
  /** Runs the clock to `to` in 25 ms ticks, as the worker's interval does. */
  const run = (to: number) => {
    while (clock.currentTime < to - 1e-9) {
      clock.currentTime = Math.min(to, clock.currentTime + 0.025);
      scheduler.fire();
    }
  };
  return { clock, sink, click, run, scheduler };
}

describe('the standalone click', () => {
  it.each([60, 120, 200])('clicks every beat on the grid at %d bpm', (bpm) => {
    const { sink, click, run } = setup();
    click.start(settings({ bpm }));
    run(3);
    const gap = 60 / bpm;
    const whens = sink.clicks.map((entry) => entry.when);
    expect(whens.length).toBeGreaterThanOrEqual(Math.floor(2.8 / gap));
    whens.forEach((when, index) => {
      expect(when).toBeCloseTo(0.1 + index * gap, 9);
    });
    expect(sink.clicks.every((entry) => entry.calledAt <= entry.when)).toBe(true);
  });

  it('accents the first beat of each bar, or the beats the pattern names', () => {
    const { sink, click, run } = setup();
    click.start(settings({ bpm: 240, beatsPerBar: 3 }));
    run(2);
    expect(sink.clicks.slice(0, 7).map((entry) => entry.accent)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    const patterned = setup();
    patterned.click.start(
      settings({ bpm: 240, beatsPerBar: 4, accents: [true, false, true, false] }),
    );
    patterned.run(2);
    expect(patterned.sink.clicks.slice(0, 4).map((entry) => entry.accent)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    const none = setup();
    none.click.start(settings({ accents: [] }));
    none.run(2);
    expect(none.sink.clicks.some((entry) => entry.accent)).toBe(false);
  });

  it.each([2, 3, 4] as const)('subdivides each beat in %d, soft between beats', (subdivision) => {
    const { sink, click, run } = setup();
    click.start(settings({ bpm: 60, beatsPerBar: 2, subdivision }));
    run(2.5);
    const clicks = sink.clicks.slice(0, subdivision * 2);
    clicks.forEach((entry, index) => {
      expect(entry.when).toBeCloseTo(0.1 + index / subdivision, 9);
      expect(entry.subdivision).toBe(index % subdivision !== 0);
      expect(entry.accent).toBe(index === 0);
    });
  });

  it('lands a tempo change on the next click, with no gap or doubled click', () => {
    const { sink, click, run, clock } = setup();
    click.start(settings({ bpm: 60 }));
    run(1.25);
    expect(clock.currentTime).toBeCloseTo(1.25, 9);
    click.update(settings({ bpm: 120 }));
    run(4);
    const whens = sink.clicks.map((entry) => entry.when);
    const gaps = whens.slice(1).map((when, index) => when - (whens[index] ?? 0));
    // 1 s gaps up to the click already scheduled in the lookahead, 0.5 s after it.
    const firstFast = gaps.findIndex((gap) => gap < 0.75);
    expect(firstFast).toBeGreaterThan(0);
    expect(gaps.slice(0, firstFast).every((gap) => Math.abs(gap - 1) < 1e-9)).toBe(true);
    expect(gaps.slice(firstFast).every((gap) => Math.abs(gap - 0.5) < 1e-9)).toBe(true);
    // The next beat after the change keeps its place; the gap after it is the new one.
    expect(whens[firstFast]).toBeLessThanOrEqual(1.25 + 1 + 1e-9);
  });

  it('applies a new subdivision at the next beat boundary, keeping the bar', () => {
    const { sink, click, run } = setup();
    click.start(settings({ bpm: 120, beatsPerBar: 4 }));
    run(0.6);
    click.update(settings({ bpm: 120, beatsPerBar: 4, subdivision: 2 }));
    run(2);
    const beatsOnly = sink.clicks.filter((entry) => !entry.subdivision);
    beatsOnly.forEach((entry, index) => {
      expect(entry.accent).toBe(index % 4 === 0);
    });
    const times = sink.clicks.map((entry) => entry.when);
    times.slice(1).forEach((when, index) => {
      const gap = when - (times[index] ?? 0);
      expect([0.5, 0.25].some((expected) => Math.abs(gap - expected) < 1e-9)).toBe(true);
    });
    expect(sink.clicks.some((entry) => entry.subdivision)).toBe(true);
  });

  it('re-times the next click at the new gap when the tempo rises from a slow one', () => {
    const { sink, click, run, clock } = setup();
    click.start(settings({ bpm: 10 }));
    run(0.5);
    click.update(settings({ bpm: 200 }));
    run(1.5);
    // 10 bpm would have waited until 6.1 s; one new gap (0.3 s) after the last click, at 0.1 s,
    // is already past, so the click is clamped to now and the next follows one gap later.
    const after = sink.clicks.filter((entry) => entry.when > 0.5 - 1e-9);
    expect(after[0]?.when).toBeLessThan(clock.currentTime);
    expect(after[0]?.when).toBeCloseTo(0.51, 9);
    expect(after[1]?.when).toBeCloseTo(0.81, 9);
  });

  it('never schedules a re-timed click in the past', () => {
    const { sink, click, run, clock } = setup();
    click.start(settings({ bpm: 10 }));
    run(2);
    click.update(settings({ bpm: 600 }));
    run(2.5);
    sink.clicks
      .filter((entry) => entry.when > 2)
      .forEach((entry) => {
        expect(entry.when).toBeGreaterThanOrEqual(entry.calledAt);
      });
    expect(clock.currentTime).toBeCloseTo(2.5, 9);
  });

  it.each([
    // [from, to, beats played before the change, expected accents after it]
    { from: 4, to: 3, played: 2, accents: [false, true, false, false, true] },
    { from: 4, to: 3, played: 3, accents: [true, false, false, true] },
    { from: 3, to: 4, played: 2, accents: [false, false, true, false, false, false] },
    { from: 4, to: 3, played: 1, accents: [false, false, true, false, false, true] },
  ])(
    'takes the bar in progress when the meter goes $from to $to after $played beats',
    ({ from, to, played, accents }) => {
      const { sink, click, run } = setup();
      click.start(settings({ bpm: 120, beatsPerBar: from }));
      // Beat k sounds at 0.1 + k / 2; the change falls just after beat `played - 1`.
      run(0.1 + (played - 1) / 2 + 0.1);
      expect(
        sink.clicks.filter((entry) => entry.when < 0.1 + (played - 1) / 2 + 0.31),
      ).toHaveLength(played + 0);
      click.update(settings({ bpm: 120, beatsPerBar: to }));
      run(6);
      expect(
        sink.clicks
          .filter((entry) => entry.when > 0.1 + (played - 1) / 2 + 0.31)
          .slice(0, accents.length)
          .map((entry) => entry.accent),
      ).toEqual(accents);
    },
  );

  it('sets the volume at once and silences from now on stop', () => {
    const { sink, click, run, clock, scheduler } = setup();
    click.start(settings({ volume: 0.3 }));
    expect(sink.volume).toBe(0.3);
    run(0.5);
    click.update(settings({ volume: 0.8 }));
    expect(sink.volume).toBe(0.8);
    click.stop();
    expect(sink.cuts.at(-1)).toMatchObject({ kind: 'clicks', when: clock.currentTime });
    const count = sink.clicks.length;
    scheduler.fire();
    expect(sink.clicks).toHaveLength(count);
    expect(click.running).toBe(false);
  });

  it('restarts on the bar with its first beat', () => {
    const { sink, click, run } = setup();
    click.start(settings({ bpm: 120 }));
    run(0.8);
    click.stop();
    sink.clicks.length = 0;
    click.start();
    run(1.5);
    expect(sink.clicks[0]?.accent).toBe(true);
  });

  it('rejects settings out of range', () => {
    const { click } = setup();
    expect(() => {
      click.start(settings({ bpm: 5 }));
    }).toThrow(RangeError);
    expect(() => {
      click.update(settings({ beatsPerBar: 0 }));
    }).toThrow(RangeError);
    expect(() => {
      click.update(settings({ volume: 2 }));
    }).toThrow(RangeError);
    expect(() => {
      click.update({ ...settings(), subdivision: 5 as 1 });
    }).toThrow(RangeError);
  });
});
