import { write } from '@reprise/formats';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fourBars } from '@/test/position';
import { createTestServices, fakePlatform } from '@/test/services';

import { ContextNotStartedError } from './capture';
import { REFERENCE_STORAGE_KEY, type TunerDeps, type TunerState } from './tuner-store';
import { tunerFor } from './tuner-for';
import { createRig, type Rig } from './test-rig';

async function setup(options: { score?: boolean; deps?: Partial<TunerDeps> } = {}) {
  const rig = createRig();
  const services = createTestServices({ platform: fakePlatform({ microphone: rig.microphone }) });
  if (options.score ?? true) {
    const { bytes } = await write(fourBars(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
  }
  const tuner = tunerFor(services, { ...rig.deps, ...options.deps });
  const detach = tuner.getState().attach();
  const flush = () => act(() => Promise.resolve());
  const state = (): TunerState => tuner.getState();
  /** Starts and runs the timer until a reading shows. */
  const listen = async () => {
    state().start();
    await flush();
    rig.tick(12);
  };
  return { rig, services, tuner, detach, flush, state, listen };
}

const expectStopped = (rig: Rig, index = 0) => {
  expect(rig.streams[index]?.track.stop).toHaveBeenCalled();
  expect(rig.captures[index]?.closed).toBe(true);
  expect(rig.contexts[index]?.close).toHaveBeenCalled();
};

describe('the tuner store', () => {
  it('starts, listens and reads A2 +12 cents on the guitar track', async () => {
    const { rig, state } = await setup();
    expect(state().status).toBe('idle');
    state().start();
    expect(state().status).toBe('starting');
    expect(rig.contexts).toHaveLength(1);
    await act(() => Promise.resolve());
    expect(state().status).toBe('listening');
    rig.tick(12);
    const reading = state().reading;
    expect(((reading?.midi ?? 0) - 45) * 100).toBeCloseTo(12, 0);
    expect(reading?.held).toBe(false);
    // Standard guitar's A string is string 5.
    expect(state().autoString).toBe(5);
  });

  it('sizes the window for the lowest string: 2048 on guitar', async () => {
    const { rig, listen } = await setup();
    await listen();
    expect(rig.captures[0]?.frameSize).toBe(2048);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'noDevice'],
    ['NotReadableError', 'busy'],
    ['SecurityError', 'denied'],
  ] as const)('shows %s as %s and closes the context it made', async (name, kind) => {
    const { rig, state, flush } = await setup();
    rig.microphone.mockRejectedValueOnce(new DOMException('x', name));
    state().start();
    await flush();
    expect(state().status).toBe('error');
    expect(state().error?.kind).toBe(kind);
    expect(rig.contexts[0]?.close).toHaveBeenCalled();
    expect(state().wanted).toBe(kind === 'noDevice');
  });

  it('shows a TypeError as unsupported and any other failure with its message', async () => {
    const { rig, state, flush } = await setup();
    rig.microphone.mockRejectedValueOnce(new TypeError('no mediaDevices'));
    state().start();
    await flush();
    expect(state().error?.kind).toBe('unsupported');
    rig.microphone.mockRejectedValueOnce(new Error('weird'));
    state().start();
    await flush();
    expect(state().error).toMatchObject({ kind: 'failed' });
    expect(state().error?.message).toContain('weird');
  });

  it('asks again on Try again, which is Start', async () => {
    const { rig, state, flush } = await setup();
    rig.microphone.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    state().start();
    await flush();
    expect(state().status).toBe('error');
    state().start();
    await flush();
    expect(rig.microphone).toHaveBeenCalledTimes(2);
    expect(state().status).toBe('listening');
  });

  it('restarts once when the track ends, then reports the microphone lost', async () => {
    const { rig, state, flush, listen } = await setup();
    await listen();
    rig.captures[0]?.end();
    await flush();
    expect(state().status).toBe('listening');
    expect(rig.captures).toHaveLength(2);
    expectStopped(rig, 0);
    rig.microphone.mockRejectedValueOnce(new DOMException('x', 'NotFoundError'));
    rig.captures[1]?.end();
    await flush();
    expect(state().status).toBe('error');
    expect(state().error?.kind).toBe('lost');
  });

  it('reports a revoked permission as blocked, not disconnected', async () => {
    const { rig, state, flush, listen } = await setup();
    await listen();
    rig.microphone.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    rig.captures[0]?.end();
    await flush();
    expect(state().error?.kind).toBe('denied');
    expect(state().wanted).toBe(false);
  });

  it('shows a failure of the audio graph as such, and keeps the button usable', async () => {
    const { state, flush } = await setup({
      deps: { openCapture: () => Promise.reject(new TypeError('bad node')) },
    });
    state().start();
    await flush();
    expect(state().error?.kind).toBe('failed');
    expect(state().error?.retry).toBe(true);
  });

  it('goes back to the invitation when the context will not start', async () => {
    const { rig, state, flush } = await setup({
      deps: { openCapture: () => Promise.reject(new ContextNotStartedError()) },
    });
    state().start();
    await flush();
    expect(state()).toMatchObject({ status: 'idle', error: undefined, wanted: false });
    expect(rig.contexts[0]?.close).toHaveBeenCalled();
  });

  it('restarts after the debounce on a device change while listening', async () => {
    const { rig, state, flush, listen } = await setup();
    await listen();
    rig.devices.dispatchEvent(new Event('devicechange'));
    rig.devices.dispatchEvent(new Event('devicechange'));
    expect(rig.captures).toHaveLength(1);
    rig.elapse(500);
    await flush();
    expect(rig.captures).toHaveLength(2);
    expect(state().status).toBe('listening');
    expectStopped(rig, 0);
  });

  it('retries on a device change when no microphone was found', async () => {
    const { rig, state, flush } = await setup();
    rig.microphone.mockRejectedValueOnce(new DOMException('x', 'NotFoundError'));
    state().start();
    await flush();
    expect(state().error?.kind).toBe('noDevice');
    rig.devices.dispatchEvent(new Event('devicechange'));
    await flush();
    expect(state().status).toBe('listening');
  });

  it('Stop closes the tracks and the context, and drops the reading', async () => {
    const { rig, state, listen } = await setup();
    await listen();
    state().stop();
    expectStopped(rig);
    expect(state()).toMatchObject({ status: 'idle', wanted: false, reading: undefined });
  });

  it('detaching the panel stops capture, and attaching again resumes it', async () => {
    const { rig, state, detach, flush, tuner, listen } = await setup();
    await listen();
    detach();
    expectStopped(rig);
    expect(state().wanted).toBe(true);
    expect(state().status).toBe('idle');
    tuner.getState().attach();
    await flush();
    expect(state().status).toBe('listening');
    expect(rig.captures).toHaveLength(2);
  });

  it('stops when the page is hidden and listens again when it is visible', async () => {
    const { rig, state, flush, listen } = await setup();
    await listen();
    rig.page.visibilityState = 'hidden';
    rig.page.dispatchEvent(new Event('visibilitychange'));
    expectStopped(rig);
    expect(state().status).toBe('idle');
    rig.page.visibilityState = 'visible';
    rig.page.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(state().status).toBe('listening');
  });

  it('never started after Stop: a visible page does not wake it', async () => {
    const { rig, state, flush, listen } = await setup();
    await listen();
    state().stop();
    rig.page.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(state().status).toBe('idle');
    expect(rig.captures).toHaveLength(1);
  });

  it('keeps the reference, and refuses an invalid one', async () => {
    const { rig, state } = await setup();
    expect(state().referenceHz).toBe(440);
    expect(state().setReference(432)).toBe(true);
    expect(rig.storage.getItem(REFERENCE_STORAGE_KEY)).toBe('432');
    expect(state().setReference(414)).toBe(false);
    expect(state().setReference(440.5)).toBe(false);
    expect(state().referenceHz).toBe(432);
  });

  it('a reference of 432 moves the reading to the new notes', async () => {
    const { state, listen } = await setup();
    state().setReference(432);
    await listen();
    // 110.2 Hz is 12 cents above 440's A2 and 44 above 432's.
    const cents = ((state().reading?.midi ?? 0) - 45) * 100;
    expect(cents).toBeGreaterThan(40);
    expect(cents).toBeLessThan(47);
  });

  it('keeps a pick over auto and clears it on a track switch', async () => {
    const { services, state, listen } = await setup();
    await listen();
    state().selectString(6);
    expect(state().override).toBe(6);
    const other = services.document.getState().score?.tracks[1]?.id;
    act(() => {
      services.selection.getState().setCurrentTrack(other);
    });
    expect(state().override).toBeUndefined();
  });

  it('grows the window when a bass track with a low string is chosen', async () => {
    const { services, rig, listen } = await setup();
    await listen();
    expect(rig.captures[0]?.frameSize).toBe(2048);
    const { score } = services.document.getState();
    const track = score?.tracks[0];
    expect(track).toBeDefined();
    // A five-string bass tuning on the same track: the lowest target is B0.
    act(() => {
      services.document.setState({
        score: score &&
          track && {
            ...score,
            tracks: [{ ...track, tuning: [23, 28, 33, 38, 43] }, ...score.tracks.slice(1)],
          },
      });
    });
    expect(rig.captures[0]?.frameSize).toBe(4096);
  });

  it('chromatic without a song: no strings, and no auto string', async () => {
    const { state, listen } = await setup({ score: false });
    await listen();
    expect(state().reading).toBeDefined();
    expect(state().autoString).toBeUndefined();
  });

  it('still clears the hold when the audio clock stands still, as a suspended context does', async () => {
    const { rig, state, listen } = await setup();
    await listen();
    rig.hear.hz = undefined;
    rig.stallAudio();
    rig.tick(5);
    expect(state().reading?.held).toBe(true);
    rig.tick(80);
    expect(state().reading).toBeUndefined();
  });

  it('holds the reading when the signal stops, then clears it after 1.5 s', async () => {
    const { rig, state, listen } = await setup();
    await listen();
    rig.hear.hz = undefined;
    rig.tick(5);
    expect(state().reading?.held).toBe(true);
    rig.tick(80);
    expect(state().reading).toBeUndefined();
  });
});
