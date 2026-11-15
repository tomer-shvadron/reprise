import { describe, expect, it } from 'vitest';

import { createAudioService } from '@/app/audio/audio-service';
import { createAppServices } from '@/app/services';
import { drive, manualTicker } from '@/test/offline';
import { fakePlatform, memoryStorage } from '@/test/services';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** The master bus limiter's lookahead, which every click carries. */
const BUS_DELAY = 264 / SAMPLE_RATE;

/** Starts of the bursts of channel 0: the first sample over a floor after 20 ms of quiet. */
function onsets(buffer: AudioBuffer, floor = 0.01): number[] {
  const data = buffer.getChannelData(0);
  const found: number[] = [];
  let quietFrom = -Infinity;
  data.forEach((value, index) => {
    const at = index / buffer.sampleRate;
    if (Math.abs(value) < floor) return;
    if (at - quietFrom > 0.02) found.push(at);
    quietFrom = at;
  });
  return found;
}

/** The app's audio service clicking with no document, rendered offline. */
async function render(bpm: number, seconds: number) {
  const scheduler = manualTicker();
  const frames = manualTicker();
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const services = createAppServices({
    platform: fakePlatform(),
    storage: () => memoryStorage(),
    audio: (playback) =>
      createAudioService({
        playback,
        loadSoundfont: () => Promise.reject(new Error('the click needs no soundfont')),
        createContext: () => context,
        scheduler: scheduler.ticker,
        frames: frames.ticker,
        startLatency: START,
        defer: (run) => {
          run();
        },
      }),
  });
  expect(services.document.getState().score).toBeUndefined();
  services.audio.startClick({ bpm, volume: 1 });
  const buffer = await drive(context, { tickers: [scheduler, frames], step: 512 });
  services.dispose();
  return onsets(buffer);
}

describe('the metronome click on the real engine, with no song open', () => {
  it.each([60, 120, 200])('lands every click on the grid at %i BPM', async (bpm) => {
    const gap = 60 / bpm;
    const found = await render(bpm, START + gap * 5.5);
    expect(found).toHaveLength(6);
    const first = found[0] ?? 0;
    expect(Math.abs(first - (START + BUS_DELAY))).toBeLessThan(0.001);
    found.forEach((at, index) => {
      expect(Math.abs(at - first - index * gap)).toBeLessThan(0.001);
    });
  });
});
