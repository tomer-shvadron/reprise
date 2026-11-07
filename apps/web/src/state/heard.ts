import type { Id } from '@reprise/model';

export interface HeardPosition {
  masterBarId: Id;
  /** Ticks into the bar. */
  tick: number;
  /** Ticks across every pass, as the engine counts them. */
  playbackTick: number;
}

/**
 * The drawn playhead's position, which lags the engine's by the output latency while playing.
 * The playhead driver writes it every frame outside React, so a plain holder rather than a store.
 */
export interface HeardRef {
  current: HeardPosition | undefined;
}

export function createHeardRef(): HeardRef {
  return { current: undefined };
}
