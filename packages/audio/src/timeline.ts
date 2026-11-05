import {
  DEFAULT_BPM,
  PPQ,
  barTicks,
  beatTicks,
  expandPlaybackSequence,
  tempoMap,
} from '@reprise/model';
import type {
  Beat,
  Id,
  Note,
  PlaybackWarning,
  Score,
  TempoMap,
  TempoMapPass,
  Track,
} from '@reprise/model';

/** A score in playback order, timed at its written tempo. */
export interface Timeline {
  score: Score;
  map: TempoMap;
  /** Playback tick where the last pass ends. */
  endTick: number;
  warnings: PlaybackWarning[];
}

/** A half-open span of playback ticks. */
export interface TickRange {
  startTick: number;
  endTick: number;
}

export interface NoteOnset {
  tick: number;
  durationTicks: number;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
  /** Playback tick where the onset's pass ends. */
  barEndTick: number;
  trackIndex: number;
  voiceIndex: number;
  beatIndex: number;
  track: Track;
  beat: Beat;
  note: Note;
  /** The note on the same string in the beat after this note ends, in playback order. */
  next: NextOnString | undefined;
}

export interface NextOnString {
  note: Note;
  beat: Beat;
  tick: number;
}

export interface ClickOnset {
  tick: number;
  accent: boolean;
}

const EPSILON = 1e-6;

export function createTimeline(score: Score): Timeline {
  const { sequence, warnings } = expandPlaybackSequence(score);
  const map = tempoMap(score, sequence);
  const last = map.passes.at(-1);
  return { score, map, endTick: last ? last.startTick + last.ticks : 0, warnings };
}

/** Index of the pass holding `tick`; a tick on a boundary belongs to the pass starting there. */
export function passIndexAt(timeline: Timeline, tick: number): number {
  const { passes } = timeline.map;
  let low = 0;
  let high = passes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const pass = passes[middle];
    if (pass && pass.startTick <= tick + EPSILON) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The written tempo at `tick`, in quarter notes per minute, following ramps. */
export function bpmAtTick(timeline: Timeline, tick: number): number {
  const pass = timeline.map.passes[passIndexAt(timeline, tick)];
  if (!pass) return DEFAULT_BPM;
  const local = tick - pass.startTick;
  const segment =
    pass.segments.find((s) => local < s.tick + s.ticks - EPSILON) ?? pass.segments.at(-1);
  if (!segment) return DEFAULT_BPM;
  const within = Math.min(Math.max(local - segment.tick, 0), segment.ticks);
  return segment.startBpm + ((segment.endBpm - segment.startBpm) * within) / segment.ticks;
}

function passesOverlapping(timeline: Timeline, from: number, to: number): [number, TempoMapPass][] {
  const found: [number, TempoMapPass][] = [];
  const passes = timeline.map.passes;
  for (let index = passIndexAt(timeline, from); index < passes.length; index++) {
    const pass = passes[index];
    if (!pass || pass.startTick >= to) break;
    found.push([index, pass]);
  }
  return found;
}

function sameNote(a: Note, b: Note): boolean {
  return a.string === b.string && a.fret === b.fret;
}

interface VoicePosition {
  sequenceIndex: number;
  trackIndex: number;
  voiceIndex: number;
  beatIndex: number;
  tick: number;
}

/**
 * Follows a note's ties through its voice in playback order: the ticks they add, and the beat
 * that ends the chain with its tick, or `undefined` where the voice runs out.
 */
function followTies(
  timeline: Timeline,
  start: VoicePosition,
  beat: Beat,
  note: Note,
): { ticks: number; after: { beat: Beat; tick: number } | undefined } {
  const { passes } = timeline.map;
  const track = timeline.score.tracks[start.trackIndex];
  let sequenceIndex = start.sequenceIndex;
  let beatIndex = start.beatIndex + 1;
  let tick = start.tick + beatTicks(beat);
  let ticks = 0;
  for (;;) {
    const pass = passes[sequenceIndex];
    if (!pass || !track) return { ticks, after: undefined };
    const beats = track.bars[pass.masterBarIndex]?.voices[start.voiceIndex]?.beats ?? [];
    const candidate = beats[beatIndex];
    if (!candidate) {
      if (beatIndex === 0) return { ticks, after: undefined };
      sequenceIndex += 1;
      beatIndex = 0;
      tick = passes[sequenceIndex]?.startTick ?? tick;
      continue;
    }
    if (candidate.rest || !candidate.notes.some((next) => next.tie && sameNote(next, note))) {
      return { ticks, after: { beat: candidate, tick } };
    }
    ticks += beatTicks(candidate);
    tick += beatTicks(candidate);
    beatIndex += 1;
  }
}

/** The sounding note on `note`'s string in `after`; fretted tracks only, so drums never match. */
function nextOnString(
  note: Note,
  after: { beat: Beat; tick: number } | undefined,
): NextOnString | undefined {
  if (!after || after.beat.rest || note.string === 0) return undefined;
  const next = after.beat.notes.find((n) => n.string === note.string && !n.tie);
  return next ? { note: next, beat: after.beat, tick: after.tick } : undefined;
}

/**
 * Every note whose onset falls in `[from, to)`. Tied continuations are skipped, their length
 * folded into the origin, except one starting exactly at `runStartTick`, where playback began
 * or a loop wrapped. Durations are clipped to `limitTick`.
 */
export function notesInRange(
  timeline: Timeline,
  from: number,
  to: number,
  options: { runStartTick: number; limitTick: number },
): NoteOnset[] {
  const onsets: NoteOnset[] = [];
  for (const [sequenceIndex, pass] of passesOverlapping(timeline, from, to)) {
    const barEndTick = pass.startTick + pass.ticks;
    for (const [trackIndex, track] of timeline.score.tracks.entries()) {
      const bar = track.bars[pass.masterBarIndex];
      if (!bar) continue;
      for (const [voiceIndex, voice] of bar.voices.entries()) {
        let offset = 0;
        for (const [beatIndex, beat] of voice.beats.entries()) {
          const tick = pass.startTick + offset;
          offset += beatTicks(beat);
          if (tick < from || tick >= to || beat.rest) continue;
          for (const note of beat.notes) {
            const startsRun = Math.abs(tick - options.runStartTick) < EPSILON;
            if (note.tie && !startsRun) continue;
            const position = { sequenceIndex, trackIndex, voiceIndex, beatIndex, tick };
            const { ticks, after } = followTies(timeline, position, beat, note);
            const length = beatTicks(beat) + ticks;
            onsets.push({
              ...position,
              masterBarIndex: pass.masterBarIndex,
              passIndex: pass.passIndex,
              barEndTick,
              durationTicks: Math.max(0, Math.min(length, options.limitTick - tick)),
              track,
              beat,
              note,
              next: nextOnString(note, after),
            });
          }
        }
      }
    }
  }
  return onsets.sort((a, b) => a.tick - b.tick);
}

function beatUnit(denominator: number): number {
  return (PPQ * 4) / denominator;
}

/**
 * Metronome clicks in `[from, to)`: one per beat of the time signature, the bar's first accented.
 * An anacrusis pass is aligned to the end of its bar, so its clicks fall on the bar's last beats.
 */
export function clicksInRange(timeline: Timeline, from: number, to: number): ClickOnset[] {
  const clicks: ClickOnset[] = [];
  for (const [, pass] of passesOverlapping(timeline, from, to)) {
    const masterBar = timeline.score.masterBars[pass.masterBarIndex];
    if (!masterBar) continue;
    const unit = beatUnit(masterBar.timeSignature.denominator);
    const missing = Math.max(0, barTicks(masterBar) - pass.ticks);
    const first = Math.ceil(missing / unit - EPSILON) * unit - missing;
    for (let local = first; local < pass.ticks - EPSILON; local += unit) {
      const tick = pass.startTick + local;
      if (tick < from || tick >= to) continue;
      clicks.push({ tick, accent: Math.abs(local + missing) < EPSILON });
    }
  }
  return clicks;
}

/**
 * The count-in before playback starting at `tick`: one bar of the time signature there, in
 * ticks, shortened by the pickup when playback starts at the beginning of an anacrusis pass,
 * so the count-in and the pickup together make one bar.
 */
export function countInTicks(timeline: Timeline, tick: number): { ticks: number; unit: number } {
  const pass = timeline.map.passes[passIndexAt(timeline, tick)];
  const masterBar = pass ? timeline.score.masterBars[pass.masterBarIndex] : undefined;
  if (!pass || !masterBar) return { ticks: 0, unit: PPQ };
  const bar = barTicks(masterBar);
  const unit = beatUnit(masterBar.timeSignature.denominator);
  const atPickup = masterBar.anacrusis && Math.abs(tick - pass.startTick) < EPSILON;
  const ticks = atPickup && pass.ticks < bar - EPSILON ? bar - pass.ticks : bar;
  return { ticks, unit };
}

/**
 * The playback ticks a loop over master bars `startBar` to `endBar` covers. Where the bars play
 * more than once, the occurrence holding `near` wins, then the first starting after it, then
 * the first.
 */
export function loopRange(
  timeline: Timeline,
  range: { startBar: Id; endBar: Id },
  near: number,
): TickRange {
  const { masterBars } = timeline.score;
  const startIndex = masterBars.findIndex((bar) => bar.id === range.startBar);
  const endIndex = masterBars.findIndex((bar) => bar.id === range.endBar);
  if (startIndex < 0 || endIndex < 0) {
    throw new RangeError('setLoop: both bars must be master bars of the loaded score');
  }
  if (endIndex < startIndex) throw new RangeError('setLoop: endBar comes before startBar');

  const { passes } = timeline.map;
  const candidates: TickRange[] = [];
  for (const [index, pass] of passes.entries()) {
    if (pass.masterBarIndex !== startIndex) continue;
    const end = passes.findIndex((p, i) => i >= index && p.masterBarIndex === endIndex);
    const last = passes[end];
    if (last) candidates.push({ startTick: pass.startTick, endTick: last.startTick + last.ticks });
  }
  const chosen =
    candidates.find((c) => c.startTick <= near && near < c.endTick) ??
    candidates.find((c) => c.startTick >= near) ??
    candidates[0];
  if (!chosen) throw new RangeError('setLoop: the bars are never played in that order');
  return chosen;
}
