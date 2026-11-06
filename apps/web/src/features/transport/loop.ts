import type { Score } from '@reprise/model';

import type { AudioService } from '@/app/audio/audio-service';
import type { PlaybackStore } from '@/state/playback';
import type { BarRange } from '@/state/selection';

/** The loop's bars as 1-based numbers, or undefined when a bar is not in the score. */
export function loopBarNumbers(
  score: Score | undefined,
  range: BarRange,
): { start: number; end: number } | undefined {
  if (!score) return undefined;
  const start = score.masterBars.findIndex((bar) => bar.id === range.startBar);
  const end = score.masterBars.findIndex((bar) => bar.id === range.endBar);
  return start < 0 || end < 0 ? undefined : { start: start + 1, end: end + 1 };
}

export function wholeSong(score: Score): BarRange | undefined {
  const first = score.masterBars[0];
  const last = score.masterBars.at(-1);
  return first && last ? { startBar: first.id, endBar: last.id } : undefined;
}

/**
 * Sets the loop, or keeps the previous one when the engine cannot loop the range, and returns the
 * sentence to announce in that case. The engine stores the bars before it checks them, so the
 * previous loop is set again to bring it back in line with the store.
 */
export function applyLoop(
  deps: { audio: AudioService; playback: PlaybackStore },
  score: Score | undefined,
  range: BarRange | undefined,
): string | undefined {
  const previous = deps.playback.getState().settings.loop;
  try {
    deps.audio.setLoop(range);
    return undefined;
  } catch (error) {
    if (!(error instanceof RangeError) || !range) throw error;
    deps.audio.setLoop(previous);
    const bars = loopBarNumbers(score, range);
    return bars
      ? `Bars ${String(bars.start)} to ${String(bars.end)} can’t be looped: they never play in that order.`
      : 'Those bars can’t be looped.';
  }
}
