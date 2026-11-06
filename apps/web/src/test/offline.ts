import type { Ticker } from '@reprise/audio';

// Copied from packages/audio/src/offline-driver.ts, which the package does not export.

/** A ticker that only ticks when told to, so offline renders drive the engine deterministically. */
export interface ManualTicker {
  ticker: Ticker;
  fire(): void;
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
  };
}

/**
 * Renders `context`, suspending every `step` frames (1024 by default, about 23 ms at 44.1 kHz) to
 * run due actions and fire the tickers.
 */
export function drive(
  context: OfflineAudioContext,
  options: {
    step?: number;
    tickers: readonly ManualTicker[];
    actions?: readonly { at: number; run: () => void }[];
  },
): Promise<AudioBuffer> {
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

/** Root mean square of channel 0 over [from, to) seconds. */
export function rms(buffer: AudioBuffer, from: number, to: number): number {
  const data = buffer.getChannelData(0);
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(data.length, Math.floor(to * buffer.sampleRate));
  let sum = 0;
  for (let i = start; i < end; i++) sum += (data[i] ?? 0) ** 2;
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/** The first frame's time whose absolute value on any channel exceeds `threshold`. */
export function onset(buffer: AudioBuffer, threshold: number): number | undefined {
  let first: number | undefined;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const index = data.findIndex((value) => Math.abs(value) > threshold);
    if (index >= 0 && (first === undefined || index < first)) first = index;
  }
  return first === undefined ? undefined : first / buffer.sampleRate;
}
