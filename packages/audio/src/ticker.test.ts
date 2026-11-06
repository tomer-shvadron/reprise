import { describe, expect, it, vi } from 'vitest';

import { intervalTicker, workerTicker } from './ticker';

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('tickers', () => {
  it.each([
    ['intervalTicker', intervalTicker(5)],
    ['workerTicker', workerTicker(5)],
  ])(
    '%s ticks until cancelled',
    async (_name, ticker) => {
      let ticks = 0;
      const cancel = ticker(() => {
        ticks += 1;
      });
      // This waits out the worker's start-up latency, not tick accuracy: other files' main-thread
      // work in the page delays its spawn and first messages, up to 1.5 s under three parallel full runs.
      await vi.waitFor(
        () => {
          expect(ticks).toBeGreaterThan(3);
        },
        { timeout: 5_000 },
      );
      cancel();
      const atCancel = ticks;
      await wait(60);

      expect(atCancel).toBeGreaterThan(3);
      expect(ticks).toBe(atCancel);
    },
    30_000,
  );
});
