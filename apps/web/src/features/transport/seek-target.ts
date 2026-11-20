import { loopRange, type TickRange } from '@reprise/audio';
import type { Score } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { timelineOf } from '@/state/timeline';

import { loopBarNumbers } from './loop';
import { seekTick } from './seek';
import { playheadTick, seekTo } from './seek-commands';

/**
 * Seeks to a bar and tick: the pass in the playhead's run. A target outside an active loop turns
 * the loop off, or with `keepLoop` (a click in edit mode) is not seeked to and leaves the loop on.
 * Returns whether it seeked, so a caller announces its own result only then and never over a refusal.
 * Shared by a click in play mode and a click in edit mode, which seeks to its cursor.
 */
export function seekToBar(
  services: AppServices,
  score: Score,
  target: { masterBarIndex: number; tick: number },
  keepLoop = false,
): boolean {
  const { audio, playback, transport } = services;
  const timeline = timelineOf(score);
  const at = playheadTick(services);
  const { loop } = playback.getState().settings;
  let inLoop: TickRange | undefined;
  const bars = loop && loopBarNumbers(score, loop);
  if (loop && bars) {
    const number = target.masterBarIndex + 1;
    if (number < bars.start || number > bars.end) {
      if (keepLoop) return false;
      audio.setLoop(undefined);
    } else {
      try {
        inLoop = loopRange(timeline, loop, at);
      } catch {
        inLoop = undefined;
      }
    }
  }
  const tick = seekTick(timeline, target, at, inLoop);
  if (tick === undefined) {
    transport.getState().announce(`Bar ${String(target.masterBarIndex + 1)} is not played`);
    return false;
  }
  seekTo(services, tick);
  return true;
}
