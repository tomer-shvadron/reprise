import { describe, expect, it } from 'vitest';

import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { ClickSynth } from './click-synth';
import { createAudioEngine } from './engine';
import { drive, manualTicker } from './offline-driver';
import { Sampler } from './sampler/sampler';
import { createSamplerSink } from './sampler/sampler-sink';
import { SAMPLE_RATE, offline, peak, sineInstrument } from './sampler/test/offline';

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

/** Seconds at which the signal rises above the floor after at least 50 ms of silence. */
function onsets(data: Float32Array): number[] {
  const found: number[] = [];
  let silent = Number.POSITIVE_INFINITY;
  for (const [index, sample] of data.entries()) {
    if (Math.abs(sample) > 1e-3) {
      if (silent > 0.05 * SAMPLE_RATE) found.push(index / SAMPLE_RATE);
      silent = 0;
    } else {
      silent += 1;
    }
  }
  return found;
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
});
