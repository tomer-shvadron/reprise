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

// A hidden page's main-thread timers run once a second unless it is audible; a worker's do not.
const WORKER_SOURCE = `let handle;
onmessage = (event) => {
  clearInterval(handle);
  if (event.data > 0) handle = setInterval(() => postMessage(0), event.data);
};`;

function spawnTickerWorker(): Worker | undefined {
  if (typeof Worker !== 'function' || typeof Blob !== 'function') return undefined;
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  try {
    return new Worker(url);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An interval in a dedicated worker, so a background tab does not throttle it; `intervalTicker` where workers are unavailable. */
export function workerTicker(milliseconds: number): Ticker {
  return (callback) => {
    const worker = spawnTickerWorker();
    if (!worker) return intervalTicker(milliseconds)(callback);
    let cancelled = false;
    worker.addEventListener('message', () => {
      if (!cancelled) callback();
    });
    worker.postMessage(milliseconds);
    return () => {
      cancelled = true;
      worker.terminate();
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
