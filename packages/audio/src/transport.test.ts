import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import type { ScoreBuilder } from '@reprise/model/testing';

import { createTransport } from './transport';
import type { LoopEvent, PlaybackState, PositionEvent, Transport } from './transport';
import { drive, manualTicker } from './offline-driver';
import type { ManualTicker } from './offline-driver';
import { RecordingSink } from './recording-sink';
import { ToneSink } from './tone-sink';

const SAMPLE_RATE = 44_100;
const LATENCY = 0.1;
const MS = 0.001;

/** Four quarter notes per bar; each note's fret is its bar index, so passes are readable. */
function bars(
  count: number,
  perBar: (builder: ScoreBuilder, bar: number) => ScoreBuilder = (b) => b,
): Score {
  let builder = score().tempo(120).track('guitar');
  for (let bar = 0; bar < count; bar++) {
    builder = perBar(builder.bar(), bar);
    for (let beat = 0; beat < 4; beat++) builder = builder.beat('4', [note(1, bar)]);
  }
  return builder.build();
}

interface Harness {
  context: OfflineAudioContext;
  engine: Transport;
  sink: RecordingSink;
  scheduler: ManualTicker;
  frames: ManualTicker;
  states: PlaybackState[];
  loops: LoopEvent[];
  positions: (PositionEvent & { at: number })[];
  /** Each `onRunStart`: when, and how many notes the sink held then. */
  runStarts: { at: number; notes: number }[];
  render(actions?: { at: number; run: () => void }[]): Promise<AudioBuffer>;
}

function harness(song: Score, seconds: number): Promise<Harness> {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.ceil(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const sink = new RecordingSink(context);
  const scheduler = manualTicker();
  const frames = manualTicker();
  const runStarts: { at: number; notes: number }[] = [];
  const engine = createTransport({
    context,
    sink,
    metronome: sink,
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: LATENCY,
    onRunStart: () => runStarts.push({ at: context.currentTime, notes: sink.notes.length }),
  });
  const states: PlaybackState[] = [];
  const loops: LoopEvent[] = [];
  const positions: (PositionEvent & { at: number })[] = [];
  engine.on('state', (state) => states.push(state));
  engine.on('loop', (loop) => loops.push(loop));
  engine.on('position', (position) => positions.push({ ...position, at: context.currentTime }));
  engine.load(song);
  return Promise.resolve({
    context,
    engine,
    sink,
    scheduler,
    frames,
    states,
    loops,
    positions,
    runStarts,
    render: (actions = []) => drive(context, { tickers: [scheduler, frames], actions }),
  });
}

function expectNothingInThePast(sink: RecordingSink): void {
  for (const scheduled of [...sink.notes, ...sink.clicks]) {
    expect(scheduled.when).toBeGreaterThanOrEqual(scheduled.calledAt);
  }
}

function expectTimes(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, time] of expected.entries()) {
    expect(Math.abs((actual[index] ?? Number.NaN) - time)).toBeLessThan(MS);
  }
}

const range = (count: number, start: number, step: number): number[] =>
  Array.from({ length: count }, (_, index) => start + index * step);

describe('Transport (OfflineAudioContext)', () => {
  it('plays four bars at 120 BPM with onsets every half second', async () => {
    const h = await harness(bars(4), 8.5);
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.notes.map((n) => n.when),
      range(16, LATENCY, 0.5),
    );
    for (const [index, scheduled] of h.sink.notes.entries()) {
      expect(scheduled.duration).toBeCloseTo(0.5, 9);
      expect(scheduled.masterBarIndex).toBe(Math.floor(index / 4));
      expect(scheduled.passIndex).toBe(0);
      expect(scheduled.barEnd).toBeCloseTo(LATENCY + 2 * (Math.floor(index / 4) + 1), 9);
      if (index < 15) {
        expect(scheduled.nextOnString?.when).toBeCloseTo(scheduled.when + 0.5, 9);
        expect(scheduled.nextOnString?.note.fret).toBe(Math.floor((index + 1) / 4));
      } else {
        expect(scheduled.nextOnString).toBeUndefined();
      }
    }
    expect(h.states).toEqual(['playing', 'stopped']);
    expectNothingInThePast(h.sink);
  });

  it('renders those onsets at the expected sample offsets, within one millisecond', async () => {
    let builder = score().tempo(120).track('guitar');
    for (let bar = 0; bar < 4; bar++) {
      builder = builder.bar();
      for (let beat = 0; beat < 4; beat++) builder = builder.beat('8', [note(1, 0)]).rest('8');
    }
    const staccato = builder.build();

    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: 8.5 * SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    const scheduler = manualTicker();
    const frames = manualTicker();
    const engine = createTransport({
      context,
      sink: new ToneSink(context),
      metronome: new RecordingSink(context),
      scheduler: scheduler.ticker,
      frames: frames.ticker,
      startLatency: LATENCY,
    });
    engine.load(staccato);
    engine.play();
    const buffer = await drive(context, { tickers: [scheduler, frames] });

    const samples = buffer.getChannelData(0);
    const onsets: number[] = [];
    let silent = Number.POSITIVE_INFINITY;
    for (const [index, sample] of samples.entries()) {
      if (Math.abs(sample) > 1e-4) {
        if (silent > 0.05 * SAMPLE_RATE) onsets.push(index);
        silent = 0;
      } else {
        silent += 1;
      }
    }
    const expected = range(16, LATENCY, 0.5).map((time) => Math.round(time * SAMPLE_RATE));
    expect(onsets).toHaveLength(16);
    for (const [index, offset] of expected.entries()) {
      expect(Math.abs((onsets[index] ?? Number.NaN) - offset)).toBeLessThanOrEqual(
        SAMPLE_RATE * MS,
      );
    }
  });

  it('loops bars 2 to 3, starting at the loop, with no gap at the wrap and each pass reported', async () => {
    const song = bars(4);
    const h = await harness(song, 10.5);
    const [, second, third] = song.masterBars;
    if (!second || !third) throw new Error('fixture');
    h.engine.setLoop({ startBar: second.id, endBar: third.id });
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.notes.map((n) => n.when),
      range(22, LATENCY, 0.5),
    );
    expect(h.sink.notes.map((n) => n.note.fret)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2,
    ]);
    const barTwoStarts = h.sink.notes.filter((n) => n.note.fret === 1 && n.beatIndex === 0);
    expectTimes(
      barTwoStarts.map((n) => n.when),
      [0.1, 4.1, 8.1],
    );
    expect(h.loops.map((loop) => loop.pass)).toEqual([1, 2]);
    expectTimes(
      h.loops.map((loop) => loop.when),
      [4.1, 8.1],
    );
    // The last note of a pass has no slide target: the wrap is a discontinuity.
    for (const scheduled of h.sink.notes) {
      const lastOfPass = scheduled.note.fret === 2 && scheduled.beatIndex === 3;
      expect(scheduled.nextOnString === undefined).toBe(lastOfPass);
    }
    expectNothingInThePast(h.sink);
  });

  it('gives a tempo set from the loop handler to the first note of the next pass', async () => {
    const song = bars(4);
    const h = await harness(song, 12.5);
    const [, second, third] = song.masterBars;
    if (!second || !third) throw new Error('fixture');
    h.engine.setLoop({ startBar: second.id, endBar: third.id });
    h.engine.on('loop', (loop) => {
      if (loop.pass === 1) h.engine.setTempo('percent', 50);
    });
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.notes.map((n) => n.when),
      [...range(8, LATENCY, 0.5), ...range(8, LATENCY + 4, 1), LATENCY + 12],
    );
    expect(h.loops.map((loop) => [loop.pass, loop.when])).toEqual([
      [1, expect.closeTo(LATENCY + 4, 9) as number],
      [2, expect.closeTo(LATENCY + 12, 9) as number],
    ]);
    expectNothingInThePast(h.sink);
  });

  it('dispose cuts, stops the timers, drops handlers and disposes the sinks', async () => {
    class DisposableSink extends RecordingSink {
      disposed = 0;
      dispose(): void {
        this.disposed += 1;
      }
    }
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    const sink = new DisposableSink(context);
    const metronome = new DisposableSink(context);
    const scheduler = manualTicker();
    const frames = manualTicker();
    const engine = createTransport({
      context,
      sink,
      metronome,
      scheduler: scheduler.ticker,
      frames: frames.ticker,
      startLatency: LATENCY,
    });
    const states: PlaybackState[] = [];
    engine.on('state', (state) => states.push(state));
    engine.load(bars(2));
    engine.play();
    let disposedAt = 0;
    await drive(context, {
      tickers: [scheduler, frames],
      actions: [
        {
          at: 0.5,
          run: () => {
            disposedAt = context.currentTime;
            engine.dispose();
          },
        },
      ],
    });

    expect(sink.cuts.map((cut) => cut.when)).toEqual([disposedAt]);
    expect(metronome.cuts.map((cut) => cut.when)).toEqual([disposedAt]);
    expect(sink.notes.every((n) => n.calledAt < disposedAt)).toBe(true);
    expect(scheduler.active).toBe(0);
    expect(frames.active).toBe(0);
    expect(sink.disposed).toBe(1);
    expect(metronome.disposed).toBe(1);
    expect(states).toEqual(['playing']);
    expect(() => {
      engine.play();
    }).toThrow(/load a score first/);
  });

  it('restarts at the loop start on a seek past the loop end, without counting a pass', async () => {
    const song = bars(6);
    const h = await harness(song, 6);
    const [, second, third] = song.masterBars;
    if (!second || !third) throw new Error('fixture');
    h.engine.setLoop({ startBar: second.id, endBar: third.id });
    let seekedAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 1,
        run: () => {
          seekedAt = h.context.currentTime;
          h.engine.seek(4 * 4 * PPQ);
        },
      },
    ]);

    const after = h.sink.notes.filter((n) => n.calledAt >= seekedAt);
    expect(after[0]?.note.fret).toBe(1);
    expect(after[0]?.beatIndex).toBe(0);
    expect(after[0]?.when).toBeCloseTo(seekedAt + LATENCY, 9);
    expect(h.loops).toHaveLength(1);
    expect(h.loops[0]?.pass).toBe(1);
    expect(h.loops[0]?.when).toBeCloseTo(seekedAt + LATENCY + 4, 9);
    expectNothingInThePast(h.sink);
  });

  it('jumps to a loop set behind the playhead, without counting a pass', async () => {
    const song = bars(6);
    const h = await harness(song, 10);
    const [first, second] = song.masterBars;
    if (!first || !second) throw new Error('fixture');
    let setAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 4.5,
        run: () => {
          setAt = h.context.currentTime;
          h.engine.setLoop({ startBar: first.id, endBar: second.id });
        },
      },
    ]);

    const after = h.sink.notes.filter((n) => n.calledAt >= setAt);
    const jump = after[0];
    if (!jump) throw new Error('nothing scheduled after setLoop');
    expect(jump.note.fret).toBe(0);
    expect(jump.beatIndex).toBe(0);
    expect(jump.when).toBeGreaterThanOrEqual(setAt);
    expect(jump.when).toBeLessThanOrEqual(setAt + 0.2 + MS);
    expect(h.loops.map((loop) => loop.pass)).toEqual([1]);
    expect(h.loops[0]?.when).toBeCloseTo(jump.when + 4, 9);
    expectNothingInThePast(h.sink);
  });

  it('counts in exactly one bar before the first note', async () => {
    const h = await harness(bars(2), 6.5);
    h.engine.setCountIn(true);
    h.engine.play();
    await h.render();

    const countIn = h.sink.clicks.slice(0, 4);
    expectTimes(
      countIn.map((c) => c.when),
      range(4, LATENCY, 0.5),
    );
    expect(countIn.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(h.sink.clicks).toHaveLength(4);
    expectTimes(
      h.sink.notes.map((n) => n.when),
      range(8, LATENCY + 2, 0.5),
    );
    expect(h.states).toEqual(['counting-in', 'playing', 'stopped']);
    expect(
      h.positions.filter((p) => p.at < LATENCY + 2).every((p) => p.position.playbackTick === 0),
    ).toBe(true);
    expectNothingInThePast(h.sink);
  });

  it('counts in only the beats an anacrusis leaves', async () => {
    const pickup = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .anacrusis()
      .beat('4', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 1)])
      .build();
    const h = await harness(pickup, 4);
    h.engine.setCountIn(true);
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.clicks.map((c) => c.when),
      range(3, LATENCY, 0.5),
    );
    expectTimes(
      h.sink.notes.map((n) => n.when),
      [LATENCY + 1.5, LATENCY + 2],
    );
  });

  it('hands out a beat with grace notes before it early enough to play them', async () => {
    const graced = score()
      .tempo(60)
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 2)], { grace: [{ duration: 16, before: true, notes: [note(1, 1)] }] })
      .rest('2')
      .bar()
      .beat('4', [note(1, 3)], { grace: [{ duration: 16, before: true, notes: [note(1, 2)] }] })
      .rest('2.')
      .build();
    const h = await harness(graced, 8.5);
    h.engine.play();
    await h.render();

    const [plain, inBar, atBarStart] = h.sink.notes;
    expect(h.sink.notes).toHaveLength(3);
    expectTimes(
      h.sink.notes.map((n) => n.when),
      [LATENCY, LATENCY + 1, LATENCY + 4],
    );
    // A 16th grace at 60 BPM is 250 ms; the event must arrive at least that long before `when`
    // on top of the usual lookahead, also where the beat opens a bar.
    expect((plain?.when ?? 0) - (plain?.calledAt ?? 0)).toBeLessThanOrEqual(0.2 + 0.03);
    expect((inBar?.when ?? 0) - (inBar?.calledAt ?? 0)).toBeGreaterThanOrEqual(0.25 + 0.2 - 0.03);
    expect((atBarStart?.when ?? 0) - (atBarStart?.calledAt ?? 0)).toBeGreaterThanOrEqual(
      0.25 + 0.2 - 0.03,
    );
    expectNothingInThePast(h.sink);
  });

  it('plays the metronome with an accented downbeat while it is on', async () => {
    const h = await harness(bars(2), 4.5);
    h.engine.setMetronome(true, 0.5);
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.clicks.map((c) => c.when),
      range(8, LATENCY, 0.5),
    );
    expect(h.sink.clicks.map((c) => c.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(h.sink.volume).toBe(0.5);
  });

  it('hands a volume change on a rest beat to the sink at the rest', async () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .rest('2', { mix: { volume: { value: 40, duration: 2 } } })
      .bar()
      .beat('1', [note(1, 2)])
      .build();
    const h = await harness(song, 4.5);
    h.engine.play();
    await h.render();

    expect(h.sink.notes).toHaveLength(2);
    expect(h.sink.mixes).toHaveLength(1);
    const [mix] = h.sink.mixes;
    expect(mix).toMatchObject({ beatIndex: 1, masterBarIndex: 0, playbackTick: 2 * PPQ });
    expect(mix?.mix.volume).toEqual({ value: 40, duration: 2 });
    expect(mix?.when).toBeCloseTo(LATENCY + 1, 9);
    expect(mix?.secondsPerTick).toBeCloseTo(0.5 / PPQ, 12);
    expect(mix?.calledAt).toBeLessThanOrEqual(mix?.when ?? 0);
  });

  it('starts from the middle with the mixer changes before it in effect', async () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .rest('2', { mix: { volume: { value: 40, duration: 2 } } })
      .rest('2')
      .bar()
      .beat('1', [note(1, 2)])
      .build();
    const h = await harness(song, 3);
    h.engine.play(4 * PPQ);
    await h.render();

    expect(h.sink.notes.map((n) => n.when)).toEqual([expect.closeTo(LATENCY, 9)]);
    expect(h.sink.mixes.map((m) => [m.playbackTick, m.when, m.mix])).toEqual([
      [0, expect.closeTo(LATENCY, 9), { volume: { value: 40 } }],
    ]);
    expect(h.sink.mixes[0]?.calledAt).toBeLessThanOrEqual(h.sink.mixes[0]?.when ?? 0);
  });

  it('carries the tied notes of a held note, each with its own onset', async () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('4', [note(6, 5), note(1, 0)])
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 5)])
      .beat('4', [note(1, 7)])
      .bar()
      .beat('4', [note(6, 5, { tie: true, vibrato: 'wide' }), note(1, 8)])
      .beat('4', [note(1, 0)])
      .beat('2', [note(6, 5, { tie: true, slide: ['outDown'] })])
      .build();
    const h = await harness(song, 4.5);
    h.engine.play();
    await h.render();

    const held = h.sink.notes.filter((n) => n.note.string === 6);
    expect(held).toHaveLength(1);
    expect(held[0]?.duration).toBeCloseTo(4, 9);
    expect(
      held[0]?.continuations.map((c) => [
        c.when - LATENCY,
        c.durationTicks,
        c.note.vibrato,
        c.note.slide,
      ]),
    ).toEqual([
      [expect.closeTo(2, 9), PPQ, 'wide', undefined],
      [expect.closeTo(3, 9), 2 * PPQ, 'none', ['outDown']],
    ]);
    expect(
      h.sink.notes.filter((n) => n.note.string === 1).every((n) => n.continuations.length === 0),
    ).toBe(true);
  });

  it('honours a tempo change written in the score', async () => {
    const song = bars(4, (builder, bar) => (bar === 2 ? builder.tempo(60) : builder));
    const h = await harness(song, 13);
    h.engine.play();
    await h.render();

    expectTimes(
      h.sink.notes.map((n) => n.when),
      [...range(8, LATENCY, 0.5), ...range(8, LATENCY + 4, 1)],
    );
  });

  it('doubles every duration at 50 percent, and at the matching BPM', async () => {
    for (const [mode, value] of [
      ['percent', 50],
      ['bpm', 60],
    ] as const) {
      const h = await harness(bars(2), 8.5);
      h.engine.setTempo(mode, value);
      h.engine.play();
      await h.render();

      expectTimes(
        h.sink.notes.map((n) => n.when),
        range(8, LATENCY, 1),
      );
      for (const scheduled of h.sink.notes) expect(scheduled.duration).toBeCloseTo(1, 9);
    }
  });

  it('applies a tempo change during playback from the next scheduled event', async () => {
    const h = await harness(bars(3), 12);
    let changedAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 1,
        run: () => {
          changedAt = h.context.currentTime;
          h.engine.setTempo('percent', 50);
        },
      },
    ]);

    const times = h.sink.notes.map((n) => n.when);
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? 0));
    // The gap straddling the scheduling cursor is part old tempo, part new.
    const switchAt = gaps.findIndex((gap) => gap > 0.5 + 1e-9);
    expect(switchAt).toBeGreaterThan(0);
    for (const [index, gap] of gaps.entries()) {
      if (index < switchAt) expect(gap).toBeCloseTo(0.5, 9);
      else if (index > switchAt) expect(gap).toBeCloseTo(1, 9);
      else expect(gap).toBeLessThanOrEqual(1);
    }
    const firstMoved = times[switchAt + 1] ?? 0;
    expect(firstMoved).toBeGreaterThanOrEqual(changedAt);
    expect(times[switchAt] ?? 0).toBeLessThanOrEqual(changedAt + 0.2);
    expect(
      h.sink.notes
        .filter((n) => n.calledAt < changedAt)
        .every((n) => n.when < changedAt + 0.2 + MS),
    ).toBe(true);
    expect(h.sink.notes).toHaveLength(12);
  });

  it('seeks to a beat and resumes from it', async () => {
    const h = await harness(bars(4), 4);
    let seekedAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 1,
        run: () => {
          seekedAt = h.context.currentTime;
          h.engine.seek(2 * 4 * PPQ + PPQ);
        },
      },
    ]);

    const cut = h.sink.cuts.find((c) => c.kind === 'notes');
    expect(cut?.when).toBe(seekedAt);
    const after = h.sink.notes.filter((n) => n.calledAt >= seekedAt);
    expect(after[0]?.note.fret).toBe(2);
    expect(after[0]?.beatIndex).toBe(1);
    expect(after[0]?.when).toBeCloseTo(seekedAt + LATENCY, 9);
    expect(h.states).toEqual(['playing', 'playing']);
    const later = h.positions.filter((p) => p.at >= seekedAt + LATENCY + 0.1);
    expect(later[0]?.position.masterBarIndex).toBe(2);
    expect(later[0]?.position.beatIndex).toBe(1);
    expectNothingInThePast(h.sink);
  });

  it('releases everything on stop and schedules nothing after it', async () => {
    const h = await harness(bars(4), 3);
    let stoppedAt = 0;
    h.engine.setMetronome(true, 1);
    h.engine.play();
    await h.render([
      {
        at: 1,
        run: () => {
          stoppedAt = h.context.currentTime;
          h.engine.stop();
        },
      },
    ]);

    expect(h.sink.cuts).toEqual([
      { kind: 'notes', when: stoppedAt, calledAt: stoppedAt },
      { kind: 'clicks', when: stoppedAt, calledAt: stoppedAt },
    ]);
    expect(h.sink.notes.every((n) => n.calledAt < stoppedAt)).toBe(true);
    expect(h.scheduler.active).toBe(0);
    expect(h.frames.active).toBe(0);
    expect(h.states).toEqual(['playing', 'stopped']);
    expect(h.positions.at(-1)?.position.playbackTick).toBe(0);
  });

  it('silences a ToneSink and the click synth from the moment of stop', async () => {
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: 2 * SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    const scheduler = manualTicker();
    const frames = manualTicker();
    const engine = createTransport({
      context,
      sink: new ToneSink(context),
      scheduler: scheduler.ticker,
      frames: frames.ticker,
      startLatency: LATENCY,
    });
    engine.load(bars(4));
    engine.setMetronome(true, 1);
    engine.play();
    let stoppedAt = 0;
    const buffer = await drive(context, {
      tickers: [scheduler, frames],
      actions: [
        {
          at: 0.95,
          run: () => {
            stoppedAt = context.currentTime;
            engine.stop();
          },
        },
      ],
    });

    const samples = buffer.getChannelData(0);
    const loudBefore = samples
      .subarray(Math.round(0.6 * SAMPLE_RATE), Math.round(0.9 * SAMPLE_RATE))
      .some((sample) => Math.abs(sample) > 0.01);
    const tail = samples.subarray(Math.ceil((stoppedAt + 0.01) * SAMPLE_RATE));
    expect(loudBefore).toBe(true);
    expect(tail.every((sample) => Math.abs(sample) < 1e-6)).toBe(true);
  });

  it('pauses and resumes from where it paused', async () => {
    const h = await harness(bars(2), 4);
    let pausedAt = 0;
    let resumedAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 0.85,
        run: () => {
          pausedAt = h.context.currentTime;
          h.engine.pause();
        },
      },
      {
        at: 2,
        run: () => {
          resumedAt = h.context.currentTime;
          h.engine.play();
        },
      },
    ]);

    const pausedTick = ((pausedAt - LATENCY) / 0.5) * PPQ;
    const resumed = h.sink.notes.filter((n) => n.calledAt >= resumedAt);
    const firstTick = Math.ceil(pausedTick / PPQ) * PPQ;
    expect(resumed[0]?.playbackTick).toBeCloseTo(firstTick, 6);
    expect(resumed[0]?.when).toBeCloseTo(
      resumedAt + LATENCY + ((firstTick - pausedTick) / PPQ) * 0.5,
      6,
    );
    expect(h.states).toEqual(['playing', 'paused', 'playing']);
  });

  it('reports positions from the audio clock at frame cadence', async () => {
    const h = await harness(bars(2), 4.5);
    h.engine.play();
    await h.render();

    const during = h.positions.filter((p) => p.at >= LATENCY && p.at < LATENCY + 4);
    expect(during.length).toBeGreaterThan(150);
    for (const event of during) {
      const expected = ((event.at - LATENCY) / 0.5) * PPQ;
      expect(event.position.playbackTick).toBeCloseTo(expected, 3);
    }
    const inBarTwo = during.find((p) => p.at >= 2.2 && p.at < 2.5);
    expect(inBarTwo?.position.masterBarIndex).toBe(1);
    expect(inBarTwo?.position.beatIndex).toBe(0);
  });

  describe('a load over a loaded song', () => {
    const after = (h: Harness, time: number) =>
      h.sink.notes.filter((n) => n.calledAt >= time).map((n) => n.when);

    it('places the playhead by the rule a seek uses', async () => {
      const song = bars(4);
      const seeking = await harness(song, 2);
      const loading = await harness(song, 2);
      let seekedAt = 0;
      let loadedAt = 0;
      seeking.engine.play();
      loading.engine.play();
      await seeking.render([
        {
          at: 1,
          run: () => {
            seekedAt = seeking.context.currentTime;
            seeking.engine.seek((seekedAt - LATENCY) * 2 * PPQ);
          },
        },
      ]);
      await loading.render([
        {
          at: 1,
          run: () => {
            loadedAt = loading.context.currentTime;
            loading.engine.load(structuredClone(song));
          },
        },
      ]);

      expect(loadedAt).toBe(seekedAt);
      const seeked = after(seeking, seekedAt);
      const loaded = after(loading, loadedAt);
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded).toHaveLength(seeked.length);
      for (const [index, when] of seeked.entries()) {
        expect(Math.abs((loaded[index] ?? Number.NaN) - when)).toBeLessThan(1e-9);
      }
    });

    it('plays on after a load during a count-in, with no count-in replayed', async () => {
      const h = await harness(bars(2), 1);
      let loadedAt = 0;
      h.engine.setCountIn(true);
      h.engine.play();
      await h.render([
        {
          at: 0.5,
          run: () => {
            loadedAt = h.context.currentTime;
            h.engine.load(structuredClone(bars(2)));
          },
        },
      ]);

      expect(h.states).toEqual(['counting-in', 'playing']);
      expect(h.sink.clicks.filter((c) => c.calledAt >= loadedAt)).toEqual([]);
    });

    it('stops when the new score ends under the playhead', async () => {
      const h = await harness(bars(4), 5);
      h.engine.play();
      await h.render([
        {
          at: 4.5,
          run: () => {
            h.engine.load(bars(2));
          },
        },
      ]);

      expect(h.states).toEqual(['playing', 'playing', 'stopped']);
    });

    it('keeps the tick a seek left on a stopped transport', async () => {
      const h = await harness(bars(2), 0.1);
      h.engine.seek(2 * PPQ);
      h.engine.load(structuredClone(bars(2)));

      expect(h.states).toEqual(['stopped', 'stopped']);
      expect(h.positions.at(-1)?.position.playbackTick).toBe(2 * PPQ);
    });

    it('keeps a loop whose bars survive and clears one whose bars are gone', async () => {
      const song = bars(3);
      const [, second, third] = song.masterBars;
      if (!second || !third) throw new Error('three bars expected');
      const kept = await harness(song, 4.6);
      kept.engine.setLoop({ startBar: second.id, endBar: third.id });
      kept.engine.load(structuredClone(song));
      kept.engine.play();
      await kept.render();
      expect(kept.loops.length).toBeGreaterThan(0);

      const dropped = await harness(song, 4.6);
      dropped.engine.setLoop({ startBar: second.id, endBar: third.id });
      dropped.engine.load(bars(3));
      dropped.engine.play();
      await dropped.render();
      expect(dropped.loops).toEqual([]);
    });
  });

  it('unloads: cuts a running song, reports stopped once, and starts the next at tick 0', async () => {
    const h = await harness(bars(4), 1.5);
    let unloadedAt = 0;
    h.engine.play();
    await h.render([
      {
        at: 1,
        run: () => {
          unloadedAt = h.context.currentTime;
          h.engine.unload();
          h.engine.unload();
        },
      },
    ]);

    expect(h.sink.cuts).toContainEqual({ kind: 'notes', when: unloadedAt, calledAt: unloadedAt });
    expect(h.states).toEqual(['playing', 'stopped']);
    expect(h.scheduler.active).toBe(0);
    expect(() => {
      h.engine.seek(0);
    }).toThrow(/load a score first/);
    h.engine.load(bars(2));
    expect(h.positions.at(-1)?.position.playbackTick).toBe(0);
  });

  it('calls onRunStart as each run starts, before its first note', async () => {
    const h = await harness(bars(4), 4.5);
    h.engine.setCountIn(true);
    h.engine.play();
    await h.render([
      {
        at: 2.5,
        run: () => {
          h.engine.seek(0);
        },
      },
      {
        at: 3,
        run: () => {
          h.engine.load(structuredClone(bars(4)));
        },
      },
      {
        at: 3.5,
        run: () => {
          h.engine.pause();
        },
      },
      {
        at: 3.6,
        run: () => {
          h.engine.seek(PPQ);
          h.engine.setCountIn(false);
        },
      },
      {
        at: 3.7,
        run: () => {
          h.engine.play();
        },
      },
    ]);

    // Play, the seek and the load while running, and the resume; not the count-in's end.
    expect(h.runStarts).toHaveLength(4);
    for (const start of h.runStarts) {
      expect(h.sink.notes.slice(0, start.notes).every((n) => n.calledAt < start.at)).toBe(true);
    }
    for (const start of h.runStarts.slice(1)) {
      expect(h.sink.notes.slice(start.notes).some((n) => n.calledAt === start.at)).toBe(true);
    }
  });
});
