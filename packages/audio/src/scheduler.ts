/**
 * The scheduling core: pure functions over a `Run` and a window `(now, horizon)` of
 * `AudioContext` time. Nothing here touches Web Audio or a timer, so the core can move into a
 * worker or an AudioWorklet without change.
 *
 * Time is mapped through an anchor: playback tick `anchor.tick` sounds at `anchor.time`, and
 * later ticks follow the written tempo map stretched by `anchor.rate`. A tempo change, a seek or
 * a loop wrap starts a new anchor at the cursor, so events already handed out never move.
 */
import { PPQ, positionAtSeconds, secondsAtTick } from '@reprise/model';

import { bpmAtTick, clicksInRange, countInTicks, notesInRange } from './timeline';
import type { NextOnString, NoteOnset, TickRange, Timeline } from './timeline';

export interface Anchor {
  /** `AudioContext` time at which `tick` sounds. */
  time: number;
  tick: number;
  /** Context seconds per second of the written tempo map: 2 plays at half speed. */
  rate: number;
}

export interface ScheduledClick {
  when: number;
  accent: boolean;
  countIn: boolean;
}

export interface ScheduledNote extends NoteOnset {
  when: number;
  duration: number;
  /** Context time the onset's bar ends. */
  barEnd: number;
  /** `next` timed through the anchor; undefined where the loop or the song ends first. */
  nextOnString: (Omit<NextOnString, 'tick'> & { when: number }) | undefined;
}

export interface LoopCrossing {
  /** Loop wraps so far, from 1. */
  pass: number;
  /** Context time of the wrap. */
  when: number;
}

export interface Run {
  anchor: Anchor;
  /** First playback tick not yet scheduled. */
  cursorTick: number;
  /** Where playback started or the loop last wrapped to; a tie starting here still sounds. */
  runStartTick: number;
  loop: TickRange | undefined;
  loopPasses: number;
  countIn: readonly ScheduledClick[];
  countInNext: number;
  finished: boolean;
  /** Context time the end of the last pass is reached; set once `finished`. */
  endTime: number | undefined;
}

export interface Window {
  now: number;
  /** Everything due before this context time is handed out. */
  horizon: number;
  metronome: boolean;
  /** An event this late is moved to `now`; a later one is dropped. */
  lateTolerance?: number;
}

export interface Advanced {
  run: Run;
  notes: ScheduledNote[];
  clicks: ScheduledClick[];
  /** Anchors this call started, in time order; the cursor follows them. */
  anchors: Anchor[];
  /** Set when the loop wrapped; `advance` returns right after a wrap. */
  loop: LoopCrossing | undefined;
}

const EPSILON = 1e-6;
const DEFAULT_LATE_TOLERANCE = 0.05;
const MAX_STEPS = 64;

export function timeAtTick(timeline: Timeline, anchor: Anchor, tick: number): number {
  const delta = secondsAtTick(timeline.map, tick) - secondsAtTick(timeline.map, anchor.tick);
  return anchor.time + delta * anchor.rate;
}

/** The playback tick sounding at context `time`; the anchor's own tick before it. */
export function tickAtTime(timeline: Timeline, anchor: Anchor, time: number): number {
  if (time <= anchor.time) return anchor.tick;
  const seconds = secondsAtTick(timeline.map, anchor.tick) + (time - anchor.time) / anchor.rate;
  return positionAtSeconds(timeline.map, seconds)?.playbackTick ?? anchor.tick;
}

export interface RunStart {
  tick: number;
  /** Context time the run begins: the first count-in click, or `tick` itself without one. */
  time: number;
  rate: number;
  loop: TickRange | undefined;
  countIn: boolean;
}

export function startRun(timeline: Timeline, start: RunStart): Run {
  const clicks: ScheduledClick[] = [];
  let time = start.time;
  if (start.countIn && timeline.endTick > 0) {
    const { ticks, unit } = countInTicks(timeline, start.tick);
    const secondsPerTick = (60 / (PPQ * bpmAtTick(timeline, start.tick))) * start.rate;
    for (let offset = 0; offset < ticks - EPSILON; offset += unit) {
      clicks.push({
        when: start.time + offset * secondsPerTick,
        accent: offset === 0,
        countIn: true,
      });
    }
    time += ticks * secondsPerTick;
  }
  return {
    anchor: { time, tick: start.tick, rate: start.rate },
    cursorTick: start.tick,
    runStartTick: start.tick,
    loop: start.loop,
    loopPasses: 0,
    countIn: clicks,
    countInNext: 0,
    finished: false,
    endTime: undefined,
  };
}

/** Changes the tempo from the cursor on; everything already handed out keeps its time. */
export function retime(timeline: Timeline, run: Run, rate: number): Run {
  const time = timeAtTick(timeline, run.anchor, run.cursorTick);
  return { ...run, anchor: { time, tick: run.cursorTick, rate } };
}

export function withLoop(run: Run, loop: TickRange | undefined): Run {
  if (!loop) return { ...run, loop };
  return { ...run, loop, finished: false, endTime: undefined };
}

function activeLoop(run: Run): TickRange | undefined {
  const { loop } = run;
  return loop && loop.endTick - loop.startTick > EPSILON ? loop : undefined;
}

/**
 * Hands out every event due before `window.horizon`, from the run's cursor on. Returns early
 * after a loop wrap so the caller can react to the `loop` crossing (a speed trainer changing
 * the tempo) before the next pass is scheduled; call again until it returns no crossing.
 */
export function advance(timeline: Timeline, run: Run, window: Window): Advanced {
  const { now, horizon } = window;
  const tolerance = window.lateTolerance ?? DEFAULT_LATE_TOLERANCE;
  const fit = (when: number): number | undefined => {
    if (when >= now) return when;
    return now - when <= tolerance ? now : undefined;
  };
  const notes: ScheduledNote[] = [];
  const clicks: ScheduledClick[] = [];
  const anchors: Anchor[] = [];
  let next = run;

  let countInNext = next.countInNext;
  for (let click = next.countIn[countInNext]; click && click.when < horizon;) {
    const when = fit(click.when);
    if (when !== undefined) clicks.push({ ...click, when });
    countInNext += 1;
    click = next.countIn[countInNext];
  }
  next = { ...next, countInNext };

  for (let step = 0; step < MAX_STEPS && !next.finished; step++) {
    const loop = activeLoop(next);
    const limit = loop ? loop.endTick : timeline.endTick;
    const { anchor } = next;

    if (next.cursorTick >= limit - EPSILON) {
      const when = timeAtTick(timeline, anchor, Math.max(next.cursorTick, limit));
      if (!loop) {
        next = { ...next, finished: true, endTime: when };
        break;
      }
      // Reaching the loop end by playing is a crossing; a cursor a seek or setLoop left past it
      // only jumps back, so it neither counts a pass nor fires the event.
      const crossed = next.cursorTick <= limit + EPSILON;
      const wrapped: Anchor = { time: when, tick: loop.startTick, rate: anchor.rate };
      const loopPasses = crossed ? next.loopPasses + 1 : next.loopPasses;
      next = {
        ...next,
        anchor: wrapped,
        cursorTick: loop.startTick,
        runStartTick: loop.startTick,
        loopPasses,
      };
      anchors.push(wrapped);
      if (crossed) return { run: next, notes, clicks, anchors, loop: { pass: loopPasses, when } };
      continue;
    }

    const target = Math.min(tickAtTime(timeline, anchor, horizon), limit);
    if (target <= next.cursorTick) break;

    const range = { runStartTick: next.runStartTick, limitTick: limit };
    for (const onset of notesInRange(timeline, next.cursorTick, target, range)) {
      const start = timeAtTick(timeline, anchor, onset.tick);
      const end = timeAtTick(timeline, anchor, onset.tick + onset.durationTicks);
      const when = fit(start);
      if (when === undefined || end <= when) continue;
      const following = onset.next && onset.next.tick < limit - EPSILON ? onset.next : undefined;
      notes.push({
        ...onset,
        when,
        duration: end - when,
        barEnd: timeAtTick(timeline, anchor, onset.barEndTick),
        nextOnString: following && {
          note: following.note,
          beat: following.beat,
          when: timeAtTick(timeline, anchor, following.tick),
        },
      });
    }
    if (window.metronome) {
      for (const click of clicksInRange(timeline, next.cursorTick, target)) {
        const when = fit(timeAtTick(timeline, anchor, click.tick));
        if (when !== undefined) clicks.push({ when, accent: click.accent, countIn: false });
      }
    }
    next = { ...next, cursorTick: target };
    if (target < limit) break;
  }
  return { run: next, notes, clicks, anchors, loop: undefined };
}
