import { describe, expect, it } from 'vitest';

import { createTestServices, fakePlatform, memoryStorage } from '@/test/services';

import { BUTTERWORTH_Q_DB, createCaptureContext, openCapture } from './capture';
import { lowpassChain, whiteNoise } from './test-signals';
import { createTuner } from './tuner-store';

const A2_PLUS_7 = 110 * 2 ** (7 / 1200);

/** A second context playing a harmonic tone into a MediaStream, standing in for the microphone. */
async function fakeMicrophone(hz: number) {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const real = new Float32Array(16);
  const imag = new Float32Array(16);
  for (let n = 1; n < imag.length; n += 1) imag[n] = 1 / n;
  oscillator.setPeriodicWave(context.createPeriodicWave(real, imag));
  oscillator.frequency.value = hz;
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  await context.resume();
  return {
    stream: destination.stream,
    close: () => {
      oscillator.stop();
      void context.close();
    },
  };
}

async function render(source: Float32Array<ArrayBuffer>, cutoffHz: number, qDb: number) {
  const rate = 48000;
  const context = new OfflineAudioContext(1, source.length, rate);
  const buffer = context.createBuffer(1, source.length, rate);
  buffer.copyToChannel(source, 0);
  const player = context.createBufferSource();
  player.buffer = buffer;
  const filters = [context.createBiquadFilter(), context.createBiquadFilter()];
  for (const filter of filters) {
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;
    filter.Q.value = qDb;
  }
  player.connect(filters[0] ?? context.destination);
  filters[0]?.connect(filters[1] ?? context.destination);
  filters[1]?.connect(context.destination);
  player.start();
  return (await context.startRendering()).getChannelData(0);
}

const worstDifference = (a: Float32Array, b: Float64Array) => {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1)
    worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
};

describe('the tuner on real Web Audio', () => {
  it('reads a harmonic A2 +7 cents within 2 cents on every reading after the first', async () => {
    const mic = await fakeMicrophone(A2_PLUS_7);
    const services = createTestServices({
      platform: fakePlatform({ microphone: () => Promise.resolve(mic.stream) }),
    });
    const tuner = createTuner(services, { storage: () => memoryStorage() });
    // Every live reading counts, from the first: the cutoff ramps on the real filter when the
    // note locks, and frames read through the ramp are tens of cents off at high clarity unless
    // the tracker holds the lock back until they have passed.
    const errors: number[] = [];
    const stop = tuner.subscribe((state, previous) => {
      const { reading } = state;
      if (!reading || reading.held || reading === previous.reading) return;
      errors.push(Math.abs((reading.midi - 45) * 100 - 7));
    });
    const detach = tuner.getState().attach();
    try {
      tuner.getState().start();
      await expect.poll(() => tuner.getState().status, { timeout: 10_000 }).toBe('listening');
      await expect.poll(() => errors.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(30);
      expect(Math.max(...errors)).toBeLessThan(2);
    } finally {
      stop();
      detach();
      mic.close();
    }
  });

  it('the real two-biquad chain matches the emulation, with Q in dB', async () => {
    const noise = whiteNoise(48000, 5, 0.3);
    for (const cutoff of [1500, 205]) {
      const real = await render(noise, cutoff, BUTTERWORTH_Q_DB);
      expect(worstDifference(real, lowpassChain(noise, 48000, cutoff))).toBeLessThan(1e-4);
    }
    // A linear 0.707 handed to a dB parameter is a different filter, which the check would catch.
    const wrong = await render(noise, 205, Math.SQRT1_2);
    expect(worstDifference(wrong, lowpassChain(noise, 48000, 205))).toBeGreaterThan(1e-3);
  });

  it('closing leaves the context closed and the tracks ended', async () => {
    const mic = await fakeMicrophone(A2_PLUS_7);
    const context = createCaptureContext();
    const capture = await openCapture(mic.stream, context, 2048);
    const frame = new Float32Array(2048);
    await expect
      .poll(() => {
        capture.read(frame);
        return frame.some((v) => v !== 0);
      })
      .toBe(true);
    capture.close();
    await expect.poll(() => context.state).toBe('closed');
    expect(mic.stream.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
    mic.close();
  });
});
