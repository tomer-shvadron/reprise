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
    // A worker's first tick waits for its spawn, which a busy test page (the GM renders running
    // beside this file) can hold past a fixed window; poll instead, up to two seconds.
    for (let waited = 0; ticks <= 3 && waited < 2000; waited += 25) await wait(25);
    cancel();
    const atCancel = ticks;
    await wait(60);

    expect(atCancel).toBeGreaterThan(3);
    expect(ticks).toBe(atCancel);
  });
});
