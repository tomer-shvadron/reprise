import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextNotStartedError, openCapture, RESUME_TIMEOUT_MS } from './capture';

afterEach(() => {
  vi.useRealTimers();
});

const node = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  frequency: { value: 0 },
  Q: { value: 0 },
  type: '',
  fftSize: 0,
});

describe('openCapture', () => {
  it('gives up on a context that never starts, and closes the tracks and the context', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => Promise.resolve());
    const context = {
      state: 'suspended',
      resume: () => new Promise<void>(() => undefined),
      createMediaStreamSource: node,
      createBiquadFilter: node,
      createAnalyser: node,
      close,
    };
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }], getAudioTracks: () => [] };
    const opening = openCapture(
      stream as unknown as MediaStream,
      context as unknown as AudioContext,
      2048,
    );
    const outcome = expect(opening).rejects.toBeInstanceOf(ContextNotStartedError);
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
    await outcome;
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
