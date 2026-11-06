import type { PositionEvent } from '@reprise/audio';

import { selectRunning, type PlaybackStore } from './playback';

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface PositionReader {
  /** Calls back with the current position even if it has not changed. */
  refresh(): void;
  stop(): void;
}

export const animationFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

/**
 * Feeds the playback position to `onPosition` outside React. While the transport runs, the
 * engine writes a position every frame, so the reader coalesces writes to at most one call per
 * animation frame; while it does not, each change (a seek, a stop, a load) calls back at once.
 */
export function startPositionReader(
  playback: PlaybackStore,
  onPosition: (position: PositionEvent | undefined) => void,
  frames: FrameScheduler = animationFrames,
): PositionReader {
  let last = playback.getState().position;
  let frame: number | undefined;

  const emit = (force = false) => {
    const { position } = playback.getState();
    if (!force && position === last) return;
    last = position;
    onPosition(position);
  };

  const cancel = () => {
    if (frame !== undefined) frames.cancel(frame);
    frame = undefined;
  };

  const unsubscribe = playback.subscribe((state) => {
    if (!selectRunning(state)) {
      cancel();
      emit();
      return;
    }
    frame ??= frames.request(() => {
      frame = undefined;
      emit();
    });
  });

  onPosition(last);

  return {
    refresh() {
      emit(true);
    },
    stop() {
      unsubscribe();
      cancel();
    },
  };
}
