import { describe, expect, it } from 'vitest';

import { intervalTicker, workerTicker } from './ticker';

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('tickers', () => {
  it.each([
    ['intervalTicker', intervalTicker(5)],
    ['workerTicker', workerTicker(5)],
  ])('%s ticks until cancelled', async (_name, ticker) => {
    let ticks = 0;
    const cancel = ticker(() => {
      ticks += 1;
    });
    // Until a few ticks, not a fixed time: other test files' renders share this main thread.
    for (let waited = 0; ticks <= 3 && waited < 3000; waited += 50) await wait(50);
    cancel();
    const atCancel = ticks;
    await wait(60);

    expect(atCancel).toBeGreaterThan(3);
    expect(ticks).toBe(atCancel);
  });
});
