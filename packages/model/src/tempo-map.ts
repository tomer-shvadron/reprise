import type { BarPass } from './playback-sequence';
import type { Score } from './score';
import { PPQ, beatTicks, playedBarTicks } from './ticks';

/** The tempo before the first tempo mark, in quarter notes per minute. */
export const DEFAULT_BPM = 120;

/** A stretch of one pass with a constant tempo or a linear ramp; offsets are from the pass start. */
export interface TempoSegment {
  tick: number;
  ticks: number;
  seconds: number;
  durationSeconds: number;
  startBpm: number;
  endBpm: number;
}

export interface TempoMapPass extends BarPass {
  /** Ticks since the start of playback, counting every pass. */
  startTick: number;
  ticks: number;
  startSeconds: number;
  durationSeconds: number;
  segments: TempoSegment[];
}

export interface TempoMap {
  score: Pick<Score, 'masterBars' | 'tracks'>;
  passes: TempoMapPass[];
  durationSeconds: number;
}

interface TempoEvent {
  tick: number;
  bpm: number;
  rampTicks: number;
}

interface Ramp {
  target: number;
  perTick: number;
  remaining: number;
}

const EPSILON = 1e-9;

function segmentSeconds(ticks: number, startBpm: number, endBpm: number): number {
  if (Math.abs(endBpm - startBpm) < EPSILON) return (ticks * 60) / (PPQ * startBpm);
  return ((ticks * 60) / (PPQ * (endBpm - startBpm))) * Math.log(endBpm / startBpm);
}

function ticksAfterSeconds(segment: TempoSegment, seconds: number): number {
  const { startBpm, endBpm, ticks } = segment;
  if (Math.abs(endBpm - startBpm) < EPSILON) return (seconds * PPQ * startBpm) / 60;
  const slope = (endBpm - startBpm) / ticks;
  return (startBpm * (Math.exp((seconds * PPQ * slope) / 60) - 1)) / slope;
}

/** The bar's mark, then beat-level changes; a beat-level change at tick 0 starts from the mark. */
function tempoEvents(
  score: TempoMap['score'],
  masterBarIndex: number,
  length: number,
): TempoEvent[] {
  // Tempo is global, so where tracks or voices disagree at one tick the first one wins.
  const byTick = new Map<number, TempoEvent>();
  for (const track of score.tracks) {
    for (const voice of track.bars[masterBarIndex]?.voices ?? []) {
      let tick = 0;
      for (const beat of voice.beats) {
        const tempo = beat.mix?.tempo;
        const key = Math.round(tick * 1e6);
        if (tempo && tick < length && !byTick.has(key)) {
          byTick.set(key, { tick, bpm: tempo.bpm, rampTicks: (tempo.duration ?? 0) * PPQ });
        }
        tick += beatTicks(beat);
      }
    }
  }
  const mark = score.masterBars[masterBarIndex]?.tempo;
  const beatEvents = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  return mark ? [{ tick: 0, bpm: mark.bpm, rampTicks: 0 }, ...beatEvents] : beatEvents;
}

/**
 * Times every pass of the sequence. Tempo carries over from pass to pass in playback order. A
 * beat-level change with a `duration` ramps linearly in BPM from the tempo in effect to its own
 * over `duration` quarter notes, across bar lines if need be; without one it is a step.
 */
export function tempoMap(score: TempoMap['score'], sequence: readonly BarPass[]): TempoMap {
  const passes: TempoMapPass[] = [];
  let bpm = DEFAULT_BPM;
  let ramp: Ramp | undefined;
  let startTick = 0;
  let startSeconds = 0;

  for (const pass of sequence) {
    const length = playedBarTicks(score, pass.masterBarIndex);
    const segments: TempoSegment[] = [];
    let cursor = 0;
    let seconds = 0;

    const push = (to: number, endBpm: number): void => {
      const ticks = to - cursor;
      if (ticks <= EPSILON) return;
      const durationSeconds = segmentSeconds(ticks, bpm, endBpm);
      segments.push({ tick: cursor, ticks, seconds, durationSeconds, startBpm: bpm, endBpm });
      seconds += durationSeconds;
      cursor = to;
      bpm = endBpm;
    };
    const advance = (to: number): void => {
      while (cursor < to - EPSILON) {
        if (!ramp) {
          push(to, bpm);
          return;
        }
        const end = Math.min(to, cursor + ramp.remaining);
        ramp.remaining -= end - cursor;
        if (ramp.remaining <= EPSILON) {
          push(end, ramp.target);
          ramp = undefined;
        } else {
          push(end, bpm + ramp.perTick * (end - cursor));
        }
      }
    };

    for (const event of tempoEvents(score, pass.masterBarIndex, length)) {
      advance(event.tick);
      if (event.rampTicks > 0 && Math.abs(event.bpm - bpm) > EPSILON) {
        ramp = {
          target: event.bpm,
          perTick: (event.bpm - bpm) / event.rampTicks,
          remaining: event.rampTicks,
        };
      } else {
        bpm = event.bpm;
        ramp = undefined;
      }
    }
    advance(length);

    passes.push({
      ...pass,
      startTick,
      ticks: length,
      startSeconds,
      durationSeconds: seconds,
      segments,
    });
    startTick += length;
    startSeconds += seconds;
  }

  return { score, passes, durationSeconds: startSeconds };
}

/** Seconds from the start of playback to `tick` ticks into the pass at `sequenceIndex`. */
export function secondsAt(map: TempoMap, sequenceIndex: number, tick: number): number {
  const pass = map.passes[sequenceIndex];
  if (!pass) {
    throw new RangeError(`sequence index ${String(sequenceIndex)} is outside the tempo map`);
  }
  const clamped = Math.min(Math.max(tick, 0), pass.ticks);
  for (const segment of pass.segments) {
    if (clamped <= segment.tick + segment.ticks + EPSILON) {
      const within = Math.max(0, clamped - segment.tick);
      const endBpm =
        segment.startBpm + ((segment.endBpm - segment.startBpm) * within) / segment.ticks;
      return pass.startSeconds + segment.seconds + segmentSeconds(within, segment.startBpm, endBpm);
    }
  }
  return pass.startSeconds + pass.durationSeconds;
}

/**
 * Seconds from the start of playback to `playbackTick`, a tick counted across every pass as
 * `TempoMapPass.startTick` counts it, clamped to the map. A tick on a pass boundary belongs to
 * the pass that starts there.
 */
export function secondsAtTick(map: TempoMap, playbackTick: number): number {
  if (map.passes.length === 0) return 0;
  const sequenceIndex = lastAtOrBefore(map.passes, playbackTick, (pass) => pass.startTick);
  const pass = map.passes[sequenceIndex];
  if (!pass) return 0;
  return secondsAt(map, sequenceIndex, playbackTick - pass.startTick);
}

export interface PlaybackPosition extends BarPass {
  sequenceIndex: number;
  /** Ticks into the pass. */
  tick: number;
  /** Ticks since the start of playback, counting every pass: `startTick` of the pass plus `tick`. */
  playbackTick: number;
  /** 0 to 1 across the bar. */
  barProgress: number;
  /** The beat sounding in the requested voice; `undefined` when the voice has no beats. */
  beatIndex: number | undefined;
  /** 0 to 1 across that beat; 1 past the voice's last beat in an incomplete bar. */
  beatProgress: number;
}

export interface PositionOptions {
  /** Track index whose beats `beatIndex` counts; defaults to 0. */
  track?: number;
  /** Voice index; defaults to 0. */
  voice?: number;
}

function lastAtOrBefore<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const item = items[middle];
    if (item !== undefined && key(item) <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Where playback is `seconds` after it started, clamped to the map; undefined for an empty one. */
export function positionAtSeconds(
  map: TempoMap,
  seconds: number,
  options: PositionOptions = {},
): PlaybackPosition | undefined {
  if (map.passes.length === 0) return undefined;
  const time = Math.min(Math.max(seconds, 0), map.durationSeconds);
  const sequenceIndex = lastAtOrBefore(map.passes, time, (pass) => pass.startSeconds);
  const pass = map.passes[sequenceIndex];
  if (!pass) return undefined;

  let tick = pass.ticks;
  const local = time - pass.startSeconds;
  if (time < map.durationSeconds) {
    const segment = pass.segments[lastAtOrBefore(pass.segments, local, (s) => s.seconds)];
    if (segment) {
      tick = Math.min(
        segment.tick + ticksAfterSeconds(segment, local - segment.seconds),
        pass.ticks,
      );
    }
  }

  const { track = 0, voice = 0 } = options;
  const beats = map.score.tracks[track]?.bars[pass.masterBarIndex]?.voices[voice]?.beats ?? [];
  let beatIndex: number | undefined;
  let beatProgress = 0;
  let start = 0;
  for (const [index, beat] of beats.entries()) {
    const length = beatTicks(beat);
    beatIndex = index;
    if (tick < start + length - EPSILON || index === beats.length - 1) {
      beatProgress = Math.min(Math.max((tick - start) / length, 0), 1);
      break;
    }
    start += length;
  }

  return {
    sequenceIndex,
    masterBarIndex: pass.masterBarIndex,
    passIndex: pass.passIndex,
    tick,
    playbackTick: pass.startTick + tick,
    barProgress: tick / pass.ticks,
    beatIndex,
    beatProgress,
  };
}
