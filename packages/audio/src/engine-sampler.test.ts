import { describe, expect, it } from 'vitest';

import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { ClickSynth } from './click-synth';
import { createAudioEngine } from './engine';
import { drive, manualTicker } from './offline-driver';
import { RecordingSink } from './recording-sink';
import { Sampler } from './sampler/sampler';
import { createSamplerSink } from './sampler/sampler-sink';
import { SAMPLE_RATE, offline, peak, sineInstrument, toneLevel } from './sampler/test/offline';
import type { InstrumentSink } from './sink';
import { detectOnsets } from './test/signal';

const LATENCY = 0.1;
const BEATS = 16;
const GRID = Array.from({ length: BEATS }, (_, index) => LATENCY + index * 0.5);

/** Four bars at 120 BPM: an eighth note and an eighth rest per beat, so every onset has a gap before it. */
function staccato(): Score {
  let builder = score().tempo(120).track('guitar');
  for (let bar = 0; bar < 4; bar++) {
    builder = builder.bar();
    for (let beat = 0; beat < 4; beat++) builder = builder.beat('8', [note(1, bar)]).rest('8');
  }
  return builder.build();
}

function rests(): Score {
  let builder = score().tempo(120).track('guitar');
  for (let bar = 0; bar < 4; bar++) builder = builder.bar().rest('1');
  return builder.build();
}

/** Seconds at which the signal rises above 1e-3 after at least 50 ms of silence. */
function onsets(data: Float32Array): number[] {
  return detectOnsets({ data, sampleRate: SAMPLE_RATE }, { gap: 0.05, floor: 1e-3 });
}

interface Rendered {
  data: Float32Array;
  /** The master bus's pre-delay, read off the first onset. */
  delay: number;
  onsets: number[];
}

async function render(
  song: Score,
  options: { metronome?: boolean; seconds?: number; pauseAt?: number } = {},
): Promise<Rendered & { pausedAt: number }> {
  const context = offline(options.seconds ?? 8.5);
  const sampler = new Sampler(context);
  for (const track of song.tracks) sampler.addTrack(track, sineInstrument());
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createAudioEngine({
    context,
    sink: createSamplerSink(sampler),
    metronome: new ClickSynth(context, sampler.master.input),
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: LATENCY,
  });
  await engine.load(song, { tier: 'gm', packs: [] });
  engine.setMetronome(options.metronome ?? false, 0.5);
  engine.play();
  let pausedAt = 0;
  const actions =
    options.pauseAt === undefined
      ? []
      : [
          {
            at: options.pauseAt,
            run: () => {
              pausedAt = context.currentTime;
              engine.pause();
            },
          },
        ];
  const buffer = await drive(context, { tickers: [scheduler, frames], actions });
  const data = buffer.getChannelData(0);
  const found = onsets(data);
  return { data, delay: (found[0] ?? LATENCY) - LATENCY, onsets: found, pausedAt };
}

function expectOnGrid(rendered: Rendered): void {
  expect(rendered.onsets).toHaveLength(BEATS);
  for (const [index, expected] of GRID.entries()) {
    expect(
      Math.abs((rendered.onsets[index] ?? Number.NaN) - expected - rendered.delay),
    ).toBeLessThan(0.001);
  }
}

describe('AudioEngine through the real sampler', () => {
  it('lands every onset on the grid behind the master bus pre-delay, metronome aligned', async () => {
    const notes = await render(staccato());
    const clicks = await render(rests(), { metronome: true });

    // Chromium's compressor, the bus limiter, delays everything through it by about 6 ms.
    expect(notes.delay).toBeGreaterThanOrEqual(0);
    expect(notes.delay).toBeLessThan(0.01);
    expectOnGrid(notes);
    // The clicks go through the same bus, so they arrive with the same delay as the notes.
    expectOnGrid(clicks);
    expect(Math.abs(clicks.delay - notes.delay)).toBeLessThan(0.0005);
  });

  it('silences the voices already scheduled ahead when paused', async () => {
    const rendered = await render(staccato(), { seconds: 3, pauseAt: 0.9 });

    expect(rendered.pausedAt).toBeGreaterThan(0);
    expect(rendered.onsets.filter((onset) => onset < rendered.pausedAt)).toHaveLength(2);
    // The release is 50 ms and the bus adds its pre-delay; after that, nothing.
    const quietFrom = rendered.pausedAt + 0.05 + rendered.delay + 0.005;
    expect(peak(rendered.data, quietFrom, 3)).toBeLessThan(1e-4);
  });

  it('sounds a note held under a melody for its whole tied length', async () => {
    // A2 (110 Hz) on string 6 tied twice across the bar line under quarter notes on string 1.
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('4', [note(6, 5), note(1, 0)])
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 5)])
      .beat('4', [note(1, 7)])
      .bar()
      .beat('4', [note(6, 5, { tie: true }), note(1, 8)])
      .beat('4', [note(1, 0)])
      .beat('2', [note(6, 5, { tie: true })])
      .bar()
      .rest('1')
      .build();
    const context = offline(6.5);
    const sampler = new Sampler(context);
    for (const track of song.tracks) sampler.addTrack(track, sineInstrument());
    const recording = new RecordingSink(context);
    const real = createSamplerSink(sampler);
    const sink: InstrumentSink = {
      noteOn(event) {
        recording.noteOn(event);
        real.noteOn(event);
      },
      allNotesOff(when) {
        recording.allNotesOff(when);
        real.allNotesOff(when);
      },
    };
    const scheduler = manualTicker();
    const frames = manualTicker();
    const engine = createAudioEngine({
      context,
      sink,
      metronome: new ClickSynth(context, sampler.master.input),
      scheduler: scheduler.ticker,
      frames: frames.ticker,
      startLatency: LATENCY,
    });
    await engine.load(song, { tier: 'gm', packs: [] });
    engine.play();
    const data = (await drive(context, { tickers: [scheduler, frames] })).getChannelData(0);

    const held = recording.notes.filter((event) => event.note.string === 6);
    expect(held).toHaveLength(1);
    expect(held[0]?.duration).toBeCloseTo(4, 9);
    const at = (from: number, to: number) => toneLevel(data, 110, LATENCY + from, LATENCY + to);
    const struck = at(0.1, 0.4);
    expect(struck).toBeGreaterThan(0.01);
    // Through the melody, the bar line and the second link, the bass keeps its level.
    for (const [from, to] of [
      [1.1, 1.4],
      [2.1, 2.4],
      [3.5, 3.9],
    ] as const) {
      expect(at(from, to)).toBeGreaterThan(struck * 0.7);
    }
    expect(at(4.2, 4.6)).toBeLessThan(struck * 0.01);
  });
});
