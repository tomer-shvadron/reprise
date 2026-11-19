import { debugAudioEngine } from '@reprise/audio/testing';
import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createAudioService } from '@/app/audio/audio-service';
import { createAppServices } from '@/app/services';
import { fetchSyntheticSf2 } from '@/test/assets';
import { drive, manualTicker } from '@/test/offline';
import { createTestSettings } from '@/test/settings-backend';
import { fakePlatform } from '@/test/services';

import { createSpeedTrainer } from './speed-trainer-store';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** The scheduler's lookahead and one driver step (1024 frames), which bound how early the event is. */
const LOOKAHEAD = 0.2;
const STEP = 1024 / SAMPLE_RATE;

const synthetic = fetchSyntheticSf2();

/** Four bars of quarter notes at 120 BPM, so a pass of bar 2 is 2 s at 100 percent. */
function quarters() {
  let builder = score().tempo(120).track('guitar', { program: 25 });
  for (let bar = 0; bar < 4; bar++) {
    builder = builder.bar();
    for (let beat = 0; beat < 4; beat++) builder = builder.beat('4', [note(1, 3)]);
  }
  return builder.build();
}

/** One 4.6 s offline render of pass 1 at 100 percent and the passes after at 200 percent. */
async function render(step: 'trainer' | 'microtask') {
  const scheduler = manualTicker();
  const frames = manualTicker();
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(4.6 * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const services = createAppServices({
    platform: fakePlatform(),
    settings: createTestSettings(),
    audio: (playback) =>
      createAudioService({
        playback,
        loadSoundfont: () => synthetic,
        createContext: () => context,
        scheduler: scheduler.ticker,
        frames: frames.ticker,
        startLatency: START,
        defer: (run) => {
          run();
        },
      }),
  });
  const { bytes } = await write(quarters(), 'reprise');
  await services.document.getState().openBytes('song.reprise', bytes);
  await services.audio.settled();
  services.audio.unlock();
  const bar = services.document.getState().score?.masterBars[1];
  if (!bar) throw new Error('bar 2 expected');
  services.audio.setLoop({ startBar: bar.id, endBar: bar.id });

  const { sampler } = debugAudioEngine(services.audio.debug().engine);
  if (!sampler) throw new Error('the audio service is not running');
  const onsets: { when: number; calledAt: number }[] = [];
  const noteOn = sampler.noteOn.bind(sampler);
  vi.spyOn(sampler, 'noteOn').mockImplementation((id, request) => {
    onsets.push({ when: request.when, calledAt: context.currentTime });
    return noteOn(id, request);
  });
  const loops: { when: number; arrivedAt: number }[] = [];
  services.playback.subscribe((state, previous) => {
    if (state.lastLoop && state.lastLoop !== previous.lastLoop) {
      loops.push({ when: state.lastLoop.when, arrivedAt: context.currentTime });
    }
  });

  const trainer = createSpeedTrainer(services);
  if (step === 'trainer') {
    trainer
      .getState()
      .setConfig({ unit: 'percent', start: 100, step: 100, target: 200, repsPerStep: 1 });
    trainer.getState().start();
  } else {
    // The step the trainer must not take: after the event's notification, from a microtask.
    services.audio.setTempo('percent', 100);
    services.playback.subscribe((state, previous) => {
      if (state.lastLoop && state.lastLoop !== previous.lastLoop && loops.length === 1) {
        queueMicrotask(() => {
          services.audio.setTempo('percent', 200);
        });
      }
    });
    services.audio.stop();
    services.audio.play();
  }
  await drive(context, { tickers: [scheduler, frames] });
  services.dispose();

  const first = loops[0];
  if (!first) throw new Error('no loop event');
  const whens = onsets.map((onset) => onset.when);
  return {
    first,
    onsets,
    status: trainer.getState().status,
    before: whens.filter((when) => when < first.when - 1e-6),
    after: whens.filter((when) => when >= first.when - 1e-6),
  };
}

const gaps = (times: number[]) => times.slice(1).map((time, index) => time - (times[index] ?? 0));

describe('the speed trainer on the real engine', () => {
  it('gives the new tempo to the first note of the next pass, applied from the loop event', async () => {
    const { first, onsets, status, before, after } = await render('trainer');

    // Pass 1 at 100 percent: a note every 0.5 s.
    expect(before.length).toBeGreaterThanOrEqual(4);
    for (const gap of gaps(before)) expect(gap).toBeCloseTo(0.5, 3);
    // The wrap is the first note of pass 2, which already plays at 200 percent.
    expect(after[0]).toBeCloseTo(first.when, 3);
    expect(after.length).toBeGreaterThanOrEqual(8);
    for (const gap of gaps(after)) expect(gap).toBeCloseTo(0.25, 3);
    expect(status).toBe('done');
    // Nothing was scheduled in the past.
    for (const onset of onsets) expect(onset.when).toBeGreaterThanOrEqual(onset.calledAt - 1e-6);
    // The event fires ahead of the wrap, by at most the lookahead plus one scheduler tick.
    const lead = first.when - first.arrivedAt;
    expect(lead).toBeGreaterThan(0);
    expect(lead).toBeLessThanOrEqual(LOOKAHEAD + STEP + 1e-6);
    console.info(`speed trainer loop event lead: ${(lead * 1000).toFixed(1)} ms`);
  });

  it('would miss the boundary if the step ran after the notification, from a microtask', async () => {
    const { after } = await render('microtask');

    // The next pass was already scheduled at the old tempo, so its start is not at 200 percent.
    expect(gaps(after).some((gap) => Math.abs(gap - 0.25) > 0.002)).toBe(true);
  });
});
