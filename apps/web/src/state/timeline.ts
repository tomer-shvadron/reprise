import { bpmAtTick, createTimeline, type PositionEvent, type Timeline } from '@reprise/audio';
import type { Score } from '@reprise/model';

const timelines = new WeakMap<Score, Timeline>();

/** The score's expanded playback timeline, built once per score version. */
export function timelineOf(score: Score): Timeline {
  let timeline = timelines.get(score);
  if (!timeline) {
    timeline = createTimeline(score);
    timelines.set(score, timeline);
  }
  return timeline;
}

/** The written tempo at the playhead, in quarter notes per minute, before any speed scaling. */
export function writtenBpmAt(timeline: Timeline, event: PositionEvent | undefined): number {
  return bpmAtTick(timeline, event?.position.playbackTick ?? 0);
}
