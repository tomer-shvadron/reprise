/** Calls `callback` repeatedly until the returned function is called. */
export type Ticker = (callback: () => void) => () => void;

export function intervalTicker(milliseconds: number): Ticker {
  return (callback) => {
    const handle = setInterval(callback, milliseconds);
    return () => {
      clearInterval(handle);
    };
  };
}

/** Animation-frame cadence where the environment has frames, a 16 ms timer otherwise. */
export function frameTicker(): Ticker {
  if (typeof requestAnimationFrame !== 'function') return intervalTicker(16);
  return (callback) => {
    let handle = 0;
    const loop = (): void => {
      callback();
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(handle);
    };
  };
}
