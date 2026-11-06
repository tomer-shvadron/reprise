import { bpmAtTick, loopRange, type PositionEvent, type Timeline } from '@reprise/audio';
import { positionAtSeconds, secondsAtTick, type Id } from '@reprise/model';

import { playheadAt, type FollowPolicy, type PlaybackCursor } from '@/features/score';
import { selectRunning, type TransportSettings } from '@/state/playback';
import { animationFrames, startPositionReader, type FrameScheduler } from '@/state/position-reader';
import { timelineOf } from '@/state/timeline';

import type { AppServices } from './services';

/** What the driver needs of the score view. */
export interface PlayheadView {
  setPlayhead(cursor: PlaybackCursor | undefined): void;
  followPlayhead(policy: FollowPolicy): void;
}

export interface Heard {
  masterBarId: Id;
  /** Ticks into the bar. */
  tick: number;
}

/**
 * Where the music the listener hears is: `latency` seconds behind the engine's clock while it
 * runs, scaled by the speed into written seconds. Inside an active loop it never falls before the
 * loop's start, so a wrap waits there instead of flashing the bar before the loop.
 */
export function heardPosition(
  timeline: Timeline,
  event: PositionEvent,
  latency: number,
  settings: Pick<TransportSettings, 'tempo' | 'loop'>,
  running: boolean,
): Heard {
  const exact = { masterBarId: event.masterBarId, tick: event.position.tick };
  if (!running || event.countingIn || latency <= 0) return exact;
  const { tempo, loop } = settings;
  const at = event.position.playbackTick;
  // Written seconds per real second: the speed in percent, or the BPM over the written tempo.
  const speed =
    tempo.mode === 'percent' ? tempo.value / 100 : tempo.value / bpmAtTick(timeline, at);
  let seconds = event.seconds - latency * speed;
  if (loop) {
    try {
      const range = loopRange(timeline, loop, at);
      if (at >= range.startTick && at < range.endTick) {
        seconds = Math.max(seconds, secondsAtTick(timeline.map, range.startTick));
      }
    } catch {
      // A loop the engine cannot play; nothing to hold the playhead inside.
    }
  }
  const position = positionAtSeconds(timeline.map, seconds);
  const masterBar = position && timeline.score.masterBars[position.masterBarIndex];
  return position && masterBar ? { masterBarId: masterBar.id, tick: position.tick } : exact;
}

export interface PlayheadDriver {
  /** Recomputes the playhead from the last position, after a re-layout or zoom; never follows. */
  repaint(): void;
  stop(): void;
}

/**
 * Moves the score view's playhead from the playback position, outside React, and follows it:
 * every frame while running, and on a follow request otherwise (a seek, Play, Stop, the button).
 */
export function startPlayhead(options: {
  services: Pick<AppServices, 'audio' | 'playback' | 'document' | 'layout' | 'ui' | 'selection'>;
  view: () => PlayheadView | null | undefined;
  frames?: FrameScheduler;
}): PlayheadDriver {
  const { services, view, frames = animationFrames } = options;
  const { audio, playback, document, layout, ui, selection } = services;
  let last: PositionEvent | undefined;
  let requested = false;

  const paint = (follow: boolean) => {
    const target = view();
    if (!target) return;
    const { score } = document.getState();
    const result = layout.getState().result;
    const state = playback.getState();
    const running = selectRunning(state);
    if (!score || !result || !last) {
      target.setPlayhead(undefined);
      return;
    }
    const heard = heardPosition(
      timelineOf(score),
      last,
      audio.outputLatency(),
      state.settings,
      running,
    );
    const cursor = playheadAt(result, score, heard.masterBarId, heard.tick);
    target.setPlayhead(cursor);
    if (!follow || !cursor || !ui.getState().follow.on) return;
    if (!running && !requested) return;
    const force = requested;
    requested = false;
    target.followPlayhead({
      mode: ui.getState().view.mode,
      running,
      track: selection.getState().currentTrack,
      force,
    });
  };

  const reader = startPositionReader(
    playback,
    (event) => {
      last = event;
      paint(true);
    },
    frames,
  );

  const unsubscribeUi = ui.subscribe(({ follow }, previous) => {
    if (follow.request === previous.follow.request) return;
    requested = true;
    // A request no position change consumes, such as the button while stopped.
    queueMicrotask(() => {
      if (requested && !selectRunning(playback.getState())) paint(true);
    });
  });

  const unsubscribePlayback = playback.subscribe((state, previous) => {
    if (state.transport === previous.transport) return;
    const started = selectRunning(state) && !selectRunning(previous);
    const stopped = state.transport === 'stopped';
    if (started || stopped) ui.getState().requestFollow();
  });

  const unsubscribeDocument = document.subscribe((state, previous) => {
    if (state.id !== previous.id) ui.getState().requestFollow();
  });

  return {
    repaint() {
      paint(false);
    },
    stop() {
      reader.stop();
      unsubscribeUi();
      unsubscribePlayback();
      unsubscribeDocument();
    },
  };
}
