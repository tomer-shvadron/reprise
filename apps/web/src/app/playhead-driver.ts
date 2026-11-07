import { bpmAtTick, type PositionEvent, type Timeline } from '@reprise/audio';
import { positionAtSeconds } from '@reprise/model';

import { playheadAt, type FollowPolicy, type PlaybackCursor } from '@/features/score';
import type { HeardPosition } from '@/state/heard';
import { selectRunning, type TempoSetting } from '@/state/playback';
import { animationFrames, startPositionReader, type FrameScheduler } from '@/state/position-reader';
import { timelineOf } from '@/state/timeline';

import type { AppServices } from './services';

/** What the driver needs of the score view. */
export interface PlayheadView {
  setPlayhead(cursor: PlaybackCursor | undefined): void;
  followPlayhead(policy: FollowPolicy): void;
}

export type Heard = HeardPosition;

/** Written seconds per real second: the speed in percent, or the BPM over the written tempo. */
export function speedAt(timeline: Timeline, tempo: TempoSetting, playbackTick: number): number {
  return tempo.mode === 'percent'
    ? tempo.value / 100
    : tempo.value / bpmAtTick(timeline, playbackTick);
}

/**
 * Where the music the listener hears is: `latency` seconds behind the engine's clock while it
 * runs, scaled by the speed into written seconds, but never before `floor`, the start of the
 * current stretch of continuous playback. Behind that start lies the pass before it in playback
 * order, which after a seek, a loop wrap or a jump can be anywhere in the score.
 */
export function heardPosition(
  timeline: Timeline,
  event: PositionEvent,
  latency: number,
  tempo: TempoSetting,
  running: boolean,
  floor = Number.NEGATIVE_INFINITY,
): Heard {
  const exact = {
    masterBarId: event.masterBarId,
    tick: event.position.tick,
    playbackTick: event.position.playbackTick,
  };
  if (!running || event.countingIn || latency <= 0) return exact;
  const speed = speedAt(timeline, tempo, event.position.playbackTick);
  const seconds = Math.max(event.seconds - latency * speed, floor);
  if (seconds >= event.seconds) return exact;
  const position = positionAtSeconds(timeline.map, seconds);
  const masterBar = position && timeline.score.masterBars[position.masterBarIndex];
  return position && masterBar
    ? { masterBarId: masterBar.id, tick: position.tick, playbackTick: position.playbackTick }
    : exact;
}

/** Written seconds a frame may advance beyond the elapsed time before it counts as a jump. */
const JUMP_SLACK = 0.1;

interface Run {
  floor: number;
  seconds: number;
  at: number;
}

/**
 * The start of the current stretch of continuous playback: the first running position after a
 * start or a count-in, and any position that moved back or further than the elapsed time allows
 * (a seek, a loop wrap).
 */
function nextRun(run: Run | undefined, event: PositionEvent, now: number, speed: number): Run {
  if (!run) return { floor: event.seconds, seconds: event.seconds, at: now };
  const advance = event.seconds - run.seconds;
  const jumped = advance < 0 || advance > (now - run.at) * speed + JUMP_SLACK;
  return { floor: jumped ? event.seconds : run.floor, seconds: event.seconds, at: now };
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
  services: Pick<
    AppServices,
    'audio' | 'playback' | 'document' | 'layout' | 'ui' | 'selection' | 'heard'
  >;
  view: () => PlayheadView | null | undefined;
  frames?: FrameScheduler;
  /** Real seconds, for telling a jump from playback running on. */
  now?: () => number;
}): PlayheadDriver {
  const {
    services,
    view,
    frames = animationFrames,
    now = () => performance.now() / 1000,
  } = options;
  const { audio, playback, document, layout, ui, selection, heard: drawn } = services;
  let last: PositionEvent | undefined;
  let run: Run | undefined;
  let requested = false;

  const paint = (follow: boolean) => {
    const target = view();
    if (!target) return;
    const { score } = document.getState();
    const result = layout.getState().result;
    const state = playback.getState();
    const running = selectRunning(state);
    if (!score || !result || !last) {
      drawn.current = undefined;
      target.setPlayhead(undefined);
      return;
    }
    const heard = heardPosition(
      timelineOf(score),
      last,
      audio.outputLatency(),
      state.settings.tempo,
      running,
      run?.floor,
    );
    const track = selection.getState().currentTrack;
    const cursor = playheadAt(result, score, heard.masterBarId, heard.tick, track);
    drawn.current = heard;
    target.setPlayhead(cursor);
    if (!follow || !cursor || !ui.getState().follow.on) return;
    if (!running && !requested) return;
    const force = requested;
    requested = false;
    target.followPlayhead({
      mode: ui.getState().view.mode,
      running,
      track,
      force,
    });
  };

  const reader = startPositionReader(
    playback,
    (event) => {
      last = event;
      const state = playback.getState();
      const { score } = document.getState();
      if (event && score && selectRunning(state) && !event.countingIn) {
        const timeline = timelineOf(score);
        const speed = speedAt(timeline, state.settings.tempo, event.position.playbackTick);
        run = nextRun(run, event, now(), speed);
      } else {
        run = undefined;
      }
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
      drawn.current = undefined;
      unsubscribeUi();
      unsubscribePlayback();
      unsubscribeDocument();
    },
  };
}
