import {
  DEFAULT_BPM,
  PPQ,
  barTicks,
  beatTicks,
  expandPlaybackSequence,
  tempoMap,
  tieChainOf,
  tieOriginOf,
} from '@reprise/model';
import type {
  Beat,
  Id,
  MixerChange,
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
  /** The tied notes folded into this one, in order, each up to `limitTick`. */
  continuations: TiedContinuation[];
}

export interface TiedContinuation {
  note: Note;
  beat: Beat;
  tick: number;
  durationTicks: number;
}

/** A beat carrying a mixer change, rest or not. */
export interface MixOnset {
  tick: number;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
  trackIndex: number;
  voiceIndex: number;
  beatIndex: number;
  track: Track;
  beat: Beat;
  mix: MixerChange;
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
/** The most a beat is handed out early for the grace notes before it: a quarter note. */
const MAX_GRACE_LEAD = PPQ;

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

interface VoicePosition {
  sequenceIndex: number;
  trackIndex: number;
  voiceIndex: number;
  beatIndex: number;
  tick: number;
}

function offsetOf(beats: readonly Beat[], index: number): number {
  let ticks = 0;
  for (let i = 0; i < index; i++) {
    const beat = beats[i];
    if (beat) ticks += beatTicks(beat);
  }
  return ticks;
}

/** Whether passes `from` to `to` play consecutive master bars, so a tie can hold across them. */
function contiguous(passes: readonly TempoMapPass[], from: number, to: number): boolean {
  for (let index = from; index < to; index++) {
    const pass = passes[index];
    const next = passes[index + 1];
    if (!pass || next?.masterBarIndex !== pass.masterBarIndex + 1) return false;
  }
  return true;
}

/**
 * Whether a tied note is already sounding as part of an earlier onset in this run: its origin
 * (`tieOriginOf`) is on the same fret, the bars between were played in score order, and the
 * origin is at or after `runStartTick`. Otherwise the tied note sounds on its own.
 */
function heldFromOrigin(
  timeline: Timeline,
  track: Track,
  at: VoicePosition,
  note: Note,
  runStartTick: number,
): boolean {
  const { passes } = timeline.map;
  const pass = passes[at.sequenceIndex];
  if (!pass) return false;
  const position = { bar: pass.masterBarIndex, voice: at.voiceIndex, beat: at.beatIndex };
  const origin = tieOriginOf(track, position, note);
  if (origin?.note.fret !== note.fret) return false;
  const originIndex = at.sequenceIndex - (pass.masterBarIndex - origin.bar);
  const originPass = passes[originIndex];
  if (!originPass || !contiguous(passes, originIndex, at.sequenceIndex)) return false;
  const beats = track.bars[origin.bar]?.voices[at.voiceIndex]?.beats ?? [];
  return originPass.startTick + offsetOf(beats, origin.beat) >= runStartTick - EPSILON;
}

/** The beat after `beatIndex` in its voice in playback order, or `undefined` where it runs out. */
function beatAfter(
  timeline: Timeline,
  track: Track,
  voiceIndex: number,
  from: { sequenceIndex: number; beatIndex: number },
): { beat: Beat; tick: number } | undefined {
  const { passes } = timeline.map;
  let sequenceIndex = from.sequenceIndex;
  let beatIndex = from.beatIndex + 1;
  for (;;) {
    const pass = passes[sequenceIndex];
    if (!pass) return undefined;
    const beats = track.bars[pass.masterBarIndex]?.voices[voiceIndex]?.beats ?? [];
    const beat = beats[beatIndex];
    if (beat) return { beat, tick: pass.startTick + offsetOf(beats, beatIndex) };
    if (beatIndex === 0) return undefined;
    sequenceIndex += 1;
    beatIndex = 0;
  }
}

/**
 * Follows a note's tie chain (`tieChainOf`) in playback order, while the bars play in score
 * order: the tied notes with their ticks, where the last one ends, and the beat after it.
 */
function followTies(
  timeline: Timeline,
  track: Track,
  start: VoicePosition,
  beat: Beat,
  note: Note,
): {
  end: number;
  continuations: TiedContinuation[];
  after: { beat: Beat; tick: number } | undefined;
} {
  const { passes } = timeline.map;
  const continuations: TiedContinuation[] = [];
  let end = start.tick + beatTicks(beat);
  let last = { sequenceIndex: start.sequenceIndex, beatIndex: start.beatIndex };
  const bar = passes[start.sequenceIndex]?.masterBarIndex ?? 0;
  const chain = tieChainOf(track, { bar, voice: start.voiceIndex, beat: start.beatIndex }, note);
  let sequenceIndex = start.sequenceIndex;
  for (const link of chain) {
    const target = sequenceIndex + (link.bar - (passes[sequenceIndex]?.masterBarIndex ?? 0));
    const pass = passes[target];
    if (!pass || !contiguous(passes, sequenceIndex, target)) break;
    sequenceIndex = target;
    const beats = track.bars[link.bar]?.voices[start.voiceIndex]?.beats ?? [];
    const linkBeat = beats[link.beat];
    if (!linkBeat) break;
    const tick = pass.startTick + offsetOf(beats, link.beat);
    const durationTicks = beatTicks(linkBeat);
    continuations.push({ note: link.note, beat: linkBeat, tick, durationTicks });
    end = tick + durationTicks;
    last = { sequenceIndex, beatIndex: link.beat };
  }
  return { end, continuations, after: beatAfter(timeline, track, start.voiceIndex, last) };
}

/** Ticks the grace notes played before `beat` take, which the sink needs before `when`. */
function graceLeadTicks(beat: Beat): number {
  let ticks = 0;
  for (const grace of beat.grace ?? []) {
    if (grace.before) ticks += beatTicks({ duration: grace.duration, dots: 0 });
  }
  return Math.min(ticks, MAX_GRACE_LEAD);
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
 * Every note due in `[from, to)`: its onset, or earlier by the grace notes before it (never
 * before `runStartTick`), so the sink gets those in time. A tied note held from its origin in
 * this run is skipped, its length and the note itself folded into the origin's onset; a tie
 * whose origin did not play just before it (playback started or a loop wrapped after the origin,
 * or a repeat jumped back) sounds as an onset. Durations are clipped to `limitTick`, and nothing
 * at or past it is due.
 */
export function notesInRange(
  timeline: Timeline,
  from: number,
  to: number,
  options: { runStartTick: number; limitTick: number },
): NoteOnset[] {
  const onsets: NoteOnset[] = [];
  const { limitTick } = options;
  for (const [sequenceIndex, pass] of passesOverlapping(timeline, from, to + MAX_GRACE_LEAD)) {
    const barEndTick = pass.startTick + pass.ticks;
    for (const [trackIndex, track] of timeline.score.tracks.entries()) {
      const bar = track.bars[pass.masterBarIndex];
      if (!bar) continue;
      for (const [voiceIndex, voice] of bar.voices.entries()) {
        let offset = 0;
        for (const [beatIndex, beat] of voice.beats.entries()) {
          const tick = pass.startTick + offset;
          offset += beatTicks(beat);
          if (beat.rest || tick < options.runStartTick || tick >= limitTick - EPSILON) continue;
          const due = Math.max(tick - graceLeadTicks(beat), options.runStartTick);
          if (due < from || due >= to) continue;
          const position = { sequenceIndex, trackIndex, voiceIndex, beatIndex, tick };
          for (const note of beat.notes) {
            if (note.tie && heldFromOrigin(timeline, track, position, note, options.runStartTick)) {
              continue;
            }
            const { end, continuations, after } = followTies(timeline, track, position, beat, note);
            onsets.push({
              ...position,
              masterBarIndex: pass.masterBarIndex,
              passIndex: pass.passIndex,
              barEndTick,
              durationTicks: Math.max(0, Math.min(end, limitTick) - tick),
              track,
              beat,
              note,
              next: nextOnString(note, after),
              continuations: continuations
                .filter((link) => link.tick < limitTick - EPSILON)
                .map((link) => ({
                  ...link,
                  durationTicks: Math.min(link.durationTicks, limitTick - link.tick),
                })),
            });
          }
        }
      }
    }
  }
  return onsets.sort((a, b) => a.tick - b.tick);
}

/**
 * Every beat carrying `Beat.mix` whose tick is in `[from, to)`, from `runStartTick` up to
 * `limitTick`: rests and tied continuations too, which send no note.
 */
export function mixesInRange(
  timeline: Timeline,
  from: number,
  to: number,
  options: { runStartTick: number; limitTick: number },
): MixOnset[] {
  const mixes: MixOnset[] = [];
  const low = Math.max(from, options.runStartTick);
  const high = Math.min(to, options.limitTick);
  for (const [sequenceIndex, pass] of passesOverlapping(timeline, low, high)) {
    for (const [trackIndex, track] of timeline.score.tracks.entries()) {
      const bar = track.bars[pass.masterBarIndex];
      if (!bar) continue;
      for (const [voiceIndex, voice] of bar.voices.entries()) {
        let offset = 0;
        for (const [beatIndex, beat] of voice.beats.entries()) {
          const tick = pass.startTick + offset;
          offset += beatTicks(beat);
          if (!beat.mix || tick < low - EPSILON || tick >= high - EPSILON) continue;
          mixes.push({
            tick,
            sequenceIndex,
            masterBarIndex: pass.masterBarIndex,
            passIndex: pass.passIndex,
            trackIndex,
            voiceIndex,
            beatIndex,
            track,
            beat,
            mix: beat.mix,
          });
        }
      }
    }
  }
  return mixes.sort((a, b) => a.tick - b.tick);
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
