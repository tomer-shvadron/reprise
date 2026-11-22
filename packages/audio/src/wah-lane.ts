import { beatTicks } from '@reprise/model';
import type { Track, Wah } from '@reprise/model';

import { graceLeadTicks } from './grace-lead';
import { notesInRange } from './timeline';
import type { Timeline } from './timeline';

/** Where the pedal is: `off` is no wah at all, the dry signal. */
export type WahState = Wah | 'off';

/** A tick where a track's wah state changes. */
export interface WahPoint {
  tick: number;
  state: WahState;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
}

/** A change of a track's wah state in a window, or the state a run starts in. */
export interface WahOnset extends WahPoint {
  trackIndex: number;
  track: Track;
}

interface Decision {
  tick: number;
  voice: number;
  state: WahState;
  /** Ticks the beat's grace notes sound before it: they take the beat's state. */
  lead: number;
}

const EPSILON = 1e-6;

function marked(track: Track): boolean {
  return track.bars.some((bar) =>
    bar.voices.some((voice) => voice.beats.some((beat) => beat.effects.wah !== undefined)),
  );
}

/**
 * The beats of one pass that decide the state: a marked beat sets it, whatever else it holds; a
 * beat that plays a note (an onset in `notesInRange`: a tied continuation held from its origin
 * is none, one that sounds afresh after a jump is one) with no mark turns it off. Rests, empty
 * beats and beats of held tied notes only decide nothing, so the pedal holds through them. At
 * one onset a mark wins over an unmarked beat, and the lower voice between two marks.
 */
function decisionsOf(
  track: Track,
  masterBarIndex: number,
  startTick: number,
  played: ReadonlySet<string>,
  sequenceIndex: number,
): Decision[] {
  const found: Decision[] = [];
  for (const [voice, { beats }] of (track.bars[masterBarIndex]?.voices ?? []).entries()) {
    let offset = 0;
    for (const [beatIndex, beat] of beats.entries()) {
      const tick = startTick + offset;
      offset += beatTicks(beat);
      const mark = beat.effects.wah;
      const lead = graceLeadTicks(beat);
      if (mark) found.push({ tick, voice, state: mark, lead });
      else if (played.has(`${String(sequenceIndex)}:${String(voice)}:${String(beatIndex)}`)) {
        found.push({ tick, voice, state: 'off', lead });
      }
    }
  }
  const rank = (d: Decision): number => (d.state === 'off' ? 1 : 0);
  return found.sort((a, b) => a.tick - b.tick || rank(a) - rank(b) || a.voice - b.voice);
}

function laneOf(timeline: Timeline, trackIndex: number, track: Track): WahPoint[] {
  const played = new Set(
    notesInRange(timeline, 0, timeline.endTick, { runStartTick: 0, limitTick: timeline.endTick })
      .filter((onset) => onset.trackIndex === trackIndex)
      .map((o) => `${String(o.sequenceIndex)}:${String(o.voiceIndex)}:${String(o.beatIndex)}`),
  );
  const points: WahPoint[] = [];
  let state: WahState = 'off';
  let last = Number.NEGATIVE_INFINITY;
  for (const [sequenceIndex, pass] of timeline.map.passes.entries()) {
    let at = Number.NEGATIVE_INFINITY;
    for (const decision of decisionsOf(
      track,
      pass.masterBarIndex,
      pass.startTick,
      played,
      sequenceIndex,
    )) {
      // The first decision of an onset is the one that counts.
      if (decision.tick - at < EPSILON) continue;
      at = decision.tick;
      if (decision.state === state) continue;
      state = decision.state;
      // Grace notes before the beat sound before it, in the beat's state: the change comes with
      // them, but never before the pass or the change before it.
      const tick = Math.max(decision.tick - decision.lead, pass.startTick, last);
      last = tick;
      points.push({
        tick,
        state,
        sequenceIndex,
        masterBarIndex: pass.masterBarIndex,
        passIndex: pass.passIndex,
      });
    }
  }
  return points;
}

const lanes = new WeakMap<Timeline, Map<number, WahPoint[]>>();

/**
 * The wah state changes of every fretted track that has a mark, in playback order, by track
 * index: repeats, jumps and endings are in the passes, so the state carries across them. A track
 * without a mark, and every drum or keyboard track, is not in the map, and a score with no marks
 * builds nothing. Memoised per timeline.
 */
export function wahLane(timeline: Timeline): ReadonlyMap<number, readonly WahPoint[]> {
  let lane = lanes.get(timeline);
  if (!lane) {
    lane = new Map();
    for (const [trackIndex, track] of timeline.score.tracks.entries()) {
      if (track.kind === 'fretted' && marked(track)) {
        lane.set(trackIndex, laneOf(timeline, trackIndex, track));
      }
    }
    lanes.set(timeline, lane);
  }
  return lane;
}

/** Index of the first point at or after `tick`. */
function firstFrom(points: readonly WahPoint[], tick: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((points[middle]?.tick ?? 0) < tick - EPSILON) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The state in effect just before `tick`, after the changes strictly earlier than it. */
export function wahStateBefore(timeline: Timeline, trackIndex: number, tick: number): WahState {
  const points = wahLane(timeline).get(trackIndex);
  return points?.[firstFrom(points, tick) - 1]?.state ?? 'off';
}

/** Every change in `[from, to)`, from `runStartTick` up to `limitTick`, in tick order. */
export function wahChangesInRange(
  timeline: Timeline,
  from: number,
  to: number,
  options: { runStartTick: number; limitTick: number },
): WahOnset[] {
  const low = Math.max(from, options.runStartTick);
  const high = Math.min(to, options.limitTick);
  const found: WahOnset[] = [];
  for (const [trackIndex, points] of wahLane(timeline)) {
    const track = timeline.score.tracks[trackIndex];
    if (!track) continue;
    for (let i = firstFrom(points, low); i < points.length; i++) {
      const point = points[i];
      if (!point || point.tick >= high - EPSILON) break;
      found.push({ ...point, trackIndex, track });
    }
  }
  return found.sort((a, b) => a.tick - b.tick);
}

/**
 * Where each wah track's pedal stands as a run starts at `tick`: the state before it, the
 * change on the tick itself coming through the window like any other.
 */
export function wahRestores(
  timeline: Timeline,
  tick: number,
): { trackIndex: number; track: Track; state: WahState }[] {
  const restores: { trackIndex: number; track: Track; state: WahState }[] = [];
  for (const trackIndex of wahLane(timeline).keys()) {
    const track = timeline.score.tracks[trackIndex];
    if (track)
      restores.push({ trackIndex, track, state: wahStateBefore(timeline, trackIndex, tick) });
  }
  return restores;
}
