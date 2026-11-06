import type { PositionEvent } from '@reprise/audio';
import { describe, expect, it, vi } from 'vitest';

import { fourBars, positionEventAt } from '@/test/position';

import { createPlaybackStore } from './playback';
import { startPositionReader, type FrameScheduler } from './position-reader';

function manualFrames() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const frames: FrameScheduler = {
    request: (callback) => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  const fire = () => {
    const due = [...pending.values()];
    pending.clear();
    for (const callback of due) callback();
  };
  return { frames, fire, pending };
}

const song = fourBars();
const at = (tick: number): PositionEvent => positionEventAt(song, tick);

describe('startPositionReader', () => {
  it('calls once at start, then at most once per frame while playing', () => {
    const playback = createPlaybackStore();
    const onPosition = vi.fn();
    const { frames, fire } = manualFrames();
    startPositionReader(playback, onPosition, frames);
    expect(onPosition).toHaveBeenCalledOnce();

    playback.setState({ transport: 'playing' });
    playback.setState({ position: at(480) });
    playback.setState({ position: at(960) });
    playback.setState({ position: at(1440) });
    expect(onPosition).toHaveBeenCalledOnce();
    fire();
    expect(onPosition).toHaveBeenCalledTimes(2);
    expect(onPosition).toHaveBeenLastCalledWith(playback.getState().position);
  });

  it('requests no frame once paused, and calls at once for a seek while stopped', () => {
    const playback = createPlaybackStore();
    const onPosition = vi.fn();
    const { frames, pending } = manualFrames();
    startPositionReader(playback, onPosition, frames);
    playback.setState({ transport: 'playing', position: at(480) });
    playback.setState({ transport: 'paused' });
    expect(pending.size).toBe(0);
    expect(onPosition).toHaveBeenCalledTimes(2);

    playback.setState({ position: at(3840) });
    expect(onPosition).toHaveBeenCalledTimes(3);
  });

  it('refreshes on demand and stops listening', () => {
    const playback = createPlaybackStore();
    const onPosition = vi.fn();
    const reader = startPositionReader(playback, onPosition, manualFrames().frames);
    reader.refresh();
    expect(onPosition).toHaveBeenCalledTimes(2);
    reader.stop();
    playback.setState({ position: at(960) });
    expect(onPosition).toHaveBeenCalledTimes(2);
  });
});
