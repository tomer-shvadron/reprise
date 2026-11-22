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
import type { Id, MixerChange } from '@reprise/model';

import {
  beatEventsInRange,
  bpmAtTick,
  clicksInRange,
  countInTicks,
  locateBeat,
  mixesInRange,
  notesInRange,
  passIndexAt,
} from './timeline';
import type { HitEvent, NoteEvent, WahEvent } from './sink';
import { wahChangesInRange, wahRestores } from './wah-lane';
import type { WahOnset } from './wah-lane';
import type {
  HitOnset,
  MixOnset,
  NextOnString,
  NoteOnset,
  TickRange,
  TiedContinuation,
  Timeline,
} from './timeline';

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

export interface ScheduledNote extends Omit<NoteOnset, 'continuations'> {
  when: number;
  duration: number;
  /** Context time the onset's bar ends. */
  barEnd: number;
  /** `next` timed through the anchor; undefined where the loop or the song ends first. */
  nextOnString: (Omit<NextOnString, 'tick'> & { when: number }) | undefined;
  continuations: ScheduledContinuation[];
}

export type ScheduledContinuation = Omit<TiedContinuation, 'tick'> & { when: number };

export interface ScheduledMix extends MixOnset {
  /**
   * Never earlier than `now`: a late mixer change still applies, from now on. A change replayed
   * from before the run's start point carries the run's start.
   */
  when: number;
  /** Context seconds per tick at the beat, for timing the change's `duration`. */
  secondsPerTick: number;
}

/** A golpe beat timed on the context clock. */
export interface ScheduledHit extends HitOnset {
  /** `now` for a hit handed out slightly late, within the lateness tolerance. */
  when: number;
}

/** A change of a track's wah pedal, or its state at a run's start, timed on the context clock. */
export interface ScheduledWah extends WahOnset {
  /** Never earlier than `now`: a late change still applies, from now on. */
  when: number;
  restore: boolean;
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
  /**
   * Where playback started or the loop last wrapped to: a tie starting here sounds, and the
   * mixer changes before it are replayed here.
   */
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
  /**
   * Mixer changes on beats, rests and tied continuations included; at a run start, those before
   * it, settled.
   */
  mixes: ScheduledMix[];
  /** Golpe beats, rests included; a run start does not replay the ones before it. */
  hits: ScheduledHit[];
  /**
   * Wah changes, rests and tied continuations passed over; at a run start, first, each wah
   * track's state there.
   */
  wahs: ScheduledWah[];
  clicks: ScheduledClick[];
  /** Anchors this call started, in time order; the cursor follows them. */
  anchors: Anchor[];
  /** Set when the loop wrapped; `advance` returns right after a wrap. */
  loop: LoopCrossing | undefined;
}

const EPSILON = 1e-6;
const DEFAULT_LATE_TOLERANCE = 0.05;
const MAX_STEPS = 64;
const CHANNEL_FIELDS = ['volume', 'pan', 'chorus', 'reverb', 'phaser', 'tremolo'] as const;

function withoutDuration<T extends { duration?: number }>(change: T): T {
  const copy = { ...change };
  delete copy.duration;
  return copy;
}

/** A change replayed from before the start point has run its course: its value, no transition. */
function settled(change: MixerChange): MixerChange {
  const result: MixerChange = { ...change };
  for (const field of CHANNEL_FIELDS) {
    const value = change[field];
    if (value) result[field] = withoutDuration(value);
  }
  if (change.tempo) result.tempo = withoutDuration(change.tempo);
  return result;
}

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
  const mixes: ScheduledMix[] = [];
  const hits: ScheduledHit[] = [];
  const wahs: ScheduledWah[] = [];
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
      if (crossed)
        return {
          run: next,
          notes,
          mixes,
          hits,
          wahs,
          clicks,
          anchors,
          loop: { pass: loopPasses, when },
        };
      continue;
    }

    const target = Math.min(tickAtTime(timeline, anchor, horizon), limit);
    if (target <= next.cursorTick) break;

    const range = { runStartTick: next.runStartTick, limitTick: limit };
    const secondsPerTickAt = (tick: number): number =>
      (60 / (PPQ * bpmAtTick(timeline, tick))) * anchor.rate;
    if (Math.abs(next.cursorTick - next.runStartTick) < EPSILON) {
      // The run's first window: the changes before its start point, settled, restore the mixer
      // state in effect there before the first note sounds.
      const when = Math.max(timeAtTick(timeline, anchor, next.runStartTick), now);
      const secondsPerTick = secondsPerTickAt(next.runStartTick);
      const before = { runStartTick: 0, limitTick: next.runStartTick };
      for (const mix of mixesInRange(timeline, 0, next.runStartTick, before)) {
        mixes.push({ ...mix, mix: settled(mix.mix), when, secondsPerTick });
      }
      // The pedal too, even when off: a seek out of a passage must open the filter's wet path.
      const pass = timeline.map.passes[passIndexAt(timeline, next.runStartTick)];
      for (const restore of wahRestores(timeline, next.runStartTick)) {
        wahs.push({
          ...restore,
          tick: next.runStartTick,
          sequenceIndex: passIndexAt(timeline, next.runStartTick),
          masterBarIndex: pass?.masterBarIndex ?? 0,
          passIndex: pass?.passIndex ?? 0,
          when,
          restore: true,
        });
      }
    }
    const beatEvents = beatEventsInRange(timeline, next.cursorTick, target, range);
    for (const mix of beatEvents.mixes) {
      const when = Math.max(timeAtTick(timeline, anchor, mix.tick), now);
      mixes.push({ ...mix, when, secondsPerTick: secondsPerTickAt(mix.tick) });
    }
    for (const wah of wahChangesInRange(timeline, next.cursorTick, target, range)) {
      const when = Math.max(timeAtTick(timeline, anchor, wah.tick), now);
      wahs.push({ ...wah, when, restore: false });
    }
    for (const hit of beatEvents.hits) {
      const when = fit(timeAtTick(timeline, anchor, hit.tick));
      if (when !== undefined) hits.push({ ...hit, when });
    }
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
        continuations: onset.continuations.map(({ tick, ...link }) => ({
          ...link,
          when: timeAtTick(timeline, anchor, tick),
        })),
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
  return { run: next, notes, mixes, hits, wahs, clicks, anchors, loop: undefined };
}

/** The one mapping from a scheduled note to what the sink is sent, shared by playback and preview. */
export function noteEventOf(note: ScheduledNote): NoteEvent {
  return {
    track: note.track,
    trackIndex: note.trackIndex,
    voiceIndex: note.voiceIndex,
    beat: note.beat,
    beatIndex: note.beatIndex,
    note: note.note,
    when: note.when,
    duration: note.duration,
    playbackTick: note.tick,
    durationTicks: note.durationTicks,
    sequenceIndex: note.sequenceIndex,
    masterBarIndex: note.masterBarIndex,
    passIndex: note.passIndex,
    barEnd: note.barEnd,
    nextOnString: note.nextOnString,
    continuations: note.continuations,
  };
}

/** The golpe counterpart of `noteEventOf`. */
export function hitEventOf(hit: ScheduledHit): HitEvent {
  return {
    track: hit.track,
    trackIndex: hit.trackIndex,
    voiceIndex: hit.voiceIndex,
    beat: hit.beat,
    beatIndex: hit.beatIndex,
    golpe: hit.golpe,
    when: hit.when,
    playbackTick: hit.tick,
    sequenceIndex: hit.sequenceIndex,
    masterBarIndex: hit.masterBarIndex,
    passIndex: hit.passIndex,
  };
}

/** The wah counterpart of `noteEventOf`. */
export function wahEventOf(wah: ScheduledWah): WahEvent {
  return {
    track: wah.track,
    trackIndex: wah.trackIndex,
    state: wah.state,
    when: wah.when,
    playbackTick: wah.tick,
    sequenceIndex: wah.sequenceIndex,
    masterBarIndex: wah.masterBarIndex,
    passIndex: wah.passIndex,
    restore: wah.restore,
  };
}

/** The shortest a previewed note rings: a beat at a fast tempo would otherwise be a click. */
export const PREVIEW_MIN_SECONDS = 0.6;

/** What sounds one beat: the sink's calls, in the order playback makes them. */
export interface BeatPreview {
  notes: NoteEvent[];
  hits: HitEvent[];
  /** The beat's own pedal change, when it has one; never the run-start restore. */
  wahs: WahEvent[];
}

/**
 * The events that sound one beat, planned by the same `advance` that plans playback over a run
 * that starts at the beat's grace-note lead and stops at its end, so bends,
 * slides, ties, golpes and the rest follow from one code path. Starts at `when`, at the beat's
 * own tempo and the written speed. Other beats in the lead window (a tie's origin) are dropped,
 * and a note shorter than `PREVIEW_MIN_SECONDS` rings that long. Empty for a rest with no golpe,
 * or for a track or beat the score lacks. No mixer change is sent: a preview never moves the mixer.
 */
export function previewBeatEvents(
  timeline: Timeline,
  trackId: Id,
  beatId: Id,
  when: number,
): BeatPreview {
  const preview: BeatPreview = { notes: [], hits: [], wahs: [] };
  const span = locateBeat(timeline, trackId, beatId);
  if (!span) return preview;
  const startTick = Math.max(0, span.tick - span.leadTicks);
  const endTick = span.tick + span.ticks;
  // No loop: the run's limit is the song's end, so a slide still finds its target and a tie its
  // whole chain, as in playback; the horizon alone stops the window at the beat's end.
  const run = startRun(timeline, {
    tick: startTick,
    time: when,
    rate: 1,
    loop: undefined,
    countIn: false,
  });
  const seconds = timeAtTick(timeline, run.anchor, endTick) - when;
  const advanced = advance(timeline, run, {
    now: when,
    horizon: when + seconds,
    metronome: false,
  });
  const own = (event: { track: { id: Id }; beat: { id: Id } }): boolean =>
    event.track.id === trackId && event.beat.id === beatId;
  preview.notes = advanced.notes.filter(own).map((note) => ({
    ...noteEventOf(note),
    duration: Math.max(note.duration, PREVIEW_MIN_SECONDS),
    preview: true,
  }));
  preview.hits = advanced.hits.filter(own).map((hit) => ({ ...hitEventOf(hit), preview: true }));
  preview.wahs = advanced.wahs
    .filter(
      (wah) => !wah.restore && wah.track.id === trackId && Math.abs(wah.tick - span.tick) < EPSILON,
    )
    .map(wahEventOf);
  return preview;
}
