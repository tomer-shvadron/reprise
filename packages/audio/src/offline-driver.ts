import type { Ticker } from './ticker';

/** A ticker that only ticks when told to, so offline renders drive the engine deterministically. */
export interface ManualTicker {
  ticker: Ticker;
  fire(): void;
  readonly active: number;
}

export function manualTicker(): ManualTicker {
  const callbacks = new Set<() => void>();
  return {
    ticker: (callback) => {
      const entry = (): void => {
        callback();
      };
      callbacks.add(entry);
      return () => {
        callbacks.delete(entry);
      };
    },
    fire: () => {
      for (const callback of [...callbacks]) callback();
    },
    get active() {
      return callbacks.size;
    },
  };
}

export interface DriveOptions {
  /** Frames between suspensions; a multiple of the 128-frame render quantum. */
  step?: number;
  tickers: readonly ManualTicker[];
  /** Run at the first suspension at or after `at`, before the tickers fire. */
  actions?: readonly { at: number; run: () => void }[];
}

/**
 * Renders `context`, suspending every `step` frames (1024 by default, about 23 ms at 44.1 kHz,
 * close to the engine's 25 ms timer) to run due actions and fire the tickers.
 */
export function drive(context: OfflineAudioContext, options: DriveOptions): Promise<AudioBuffer> {
  const step = options.step ?? 1024;
  const pending = [...(options.actions ?? [])].sort((a, b) => a.at - b.at);
  for (let frame = step; frame < context.length; frame += step) {
    const at = frame / context.sampleRate;
    void context.suspend(at).then(() => {
      while (pending[0] && pending[0].at <= at) pending.shift()?.run();
      for (const ticker of options.tickers) ticker.fire();
      return context.resume();
    });
  }
  return context.startRendering();
}
