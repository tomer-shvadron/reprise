import { beatTicks, type Beat, type Id, type Score, type Selection } from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { BarRange, EditCursor, EditRange, RangeEnd, SelectionState } from '@/state/selection';

import { cursorAtPosition, cursorTick, resolveCursor } from './cursor';
import { DEFAULT_LANE } from './drum-lanes';
import { move, moveTrack, type Step } from './navigation';

const EPSILON = 1e-6;

/** A point in time by bar index and ticks into the bar, never absolute ticks: pickups and over-full bars need no case. */
export interface TimePoint {
  bar: number;
  tick: number;
}

const compare = (a: TimePoint, b: TimePoint): number => {
  if (a.bar !== b.bar) return a.bar - b.bar;
  // Infinity marks a whole bar's end; `Infinity - Infinity` would be NaN.
  return a.tick === b.tick || Math.abs(a.tick - b.tick) < EPSILON ? 0 : a.tick < b.tick ? -1 : 1;
};

export interface RangeSpan {
  /** The visible tracks from the anchor's to the focus's, in score order. */
  tracks: Id[];
  /** The earlier onset; every beat starting at or after it is in. */
  start: TimePoint;
  /** Where the later end ends; a beat starting at or after it is out. `tick` is Infinity for a whole bar. */
  end: TimePoint;
}

/** The first beat of an end's own track, wherever its beat id sits. */
export function endSpan(
  score: Score,
  end: RangeEnd,
): { start: TimePoint; end: TimePoint } | undefined {
  const index = scoreIndex(score);
  if (end.beat === undefined) {
    const bar = index.barIndex.get(end.masterBar);
    return bar === undefined
      ? undefined
      : { start: { bar, tick: 0 }, end: { bar, tick: Number.POSITIVE_INFINITY } };
  }
  const info = index.beats.get(end.beat);
  const beat =
    info &&
    score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  if (!info || !beat) return undefined;
  const start = { bar: info.masterBarIndex, tick: info.tick };
  return { start, end: { bar: info.masterBarIndex, tick: info.tick + beatTicks(beat) } };
}

/** The tracks, time span and bars of a range; undefined when an end names nothing in the score. */
export function rangeSpan(
  score: Score,
  range: EditRange,
  visible: readonly Id[] = score.tracks.map(({ id }) => id),
): RangeSpan | undefined {
  const a = endSpan(score, range.anchor);
  const f = endSpan(score, range.focus);
  if (!a || !f) return undefined;
  const from = score.tracks.findIndex(({ id }) => id === range.anchor.track);
  const to = score.tracks.findIndex(({ id }) => id === range.focus.track);
  if (from < 0 || to < 0) return undefined;
  const shown = new Set(visible);
  const tracks = score.tracks
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .map(({ id }) => id)
    .filter((id) => shown.has(id));
  return {
    tracks,
    start: compare(a.start, f.start) <= 0 ? a.start : f.start,
    end: compare(a.end, f.end) >= 0 ? a.end : f.end,
  };
}

export interface RangeVoice {
  track: Id;
  /** Index into `score.masterBars`. */
  bar: number;
  voice: number;
  beats: readonly Beat[];
}

/**
 * The beats a range covers, per track, bar and voice (every voice): those whose onset lies in
 * the span. A (track, bar, voice) with no beat in the span is left out.
 */
export function rangeBeats(score: Score, range: EditRange, visible?: readonly Id[]): RangeVoice[] {
  const span = rangeSpan(score, range, visible);
  if (!span) return [];
  const out: RangeVoice[] = [];
  for (const id of span.tracks) {
    const track = score.tracks.find((candidate) => candidate.id === id);
    if (!track) continue;
    for (let bar = span.start.bar; bar <= span.end.bar; bar++) {
      track.bars[bar]?.voices.forEach((voice, index) => {
        let tick = 0;
        const beats: Beat[] = [];
        for (const beat of voice.beats) {
          const onset: TimePoint = { bar, tick };
          if (compare(onset, span.start) >= 0 && compare(onset, span.end) < 0) beats.push(beat);
          tick += beatTicks(beat);
        }
        if (beats.length > 0) out.push({ track: id, bar, voice: index, beats });
      });
    }
  }
  return out;
}

/** The master bars a range touches, in score order. */
export function rangeBars(score: Score, range: EditRange): Id[] {
  const span = rangeSpan(score, range);
  if (!span) return [];
  const ids: Id[] = [];
  for (
    let bar = span.start.bar;
    bar <= Math.min(span.end.bar, score.masterBars.length - 1);
    bar++
  ) {
    const id = score.masterBars[bar]?.id;
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** The bar range the transport reads (loop the selection), mirroring a range's master-bar span. */
export function barRangeOf(score: Score, range: EditRange): BarRange | undefined {
  const ids = rangeBars(score, range);
  const [startBar] = ids;
  const endBar = ids.at(-1);
  return startBar === undefined || endBar === undefined ? undefined : { startBar, endBar };
}

type EditPatch = Parameters<SelectionState['setEdit']>[0];

/** The store patch that sets `range`, or clears it, keeping `bars` and `barsAnchor` in step. */
export function rangePatch(score: Score, range: EditRange | undefined): EditPatch {
  if (!range) return { range: undefined, bars: undefined, barsAnchor: undefined };
  return {
    range,
    bars: barRangeOf(score, range),
    barsAnchor: range.anchor.masterBar,
  };
}

/**
 * The end of a range a cursor stands for: its beat, or its whole bar when `kind` is bars. A
 * cursor on an end slot has no beat; `endAt` names one for a beats range.
 */
export function endOf(cursor: EditCursor, kind: EditRange['kind'] = 'beats'): RangeEnd {
  return {
    track: cursor.track,
    masterBar: cursor.masterBar,
    beat: kind === 'bars' ? undefined : cursor.beat,
  };
}

/** Where a cursor stands in time: its bar and the ticks into it. */
function timeOf(score: Score, cursor: EditCursor): TimePoint | undefined {
  const at = resolveCursor(score, cursor);
  const tick = cursorTick(score, cursor);
  return at && tick !== undefined ? { bar: at.bar, tick } : undefined;
}

/**
 * The end of a beats range for a cursor. A beat names itself. An end slot sits after the voice's
 * last beat, and `RangeEnd` cannot name a slot, so it takes a neighbouring beat instead: as the
 * earlier end, the first beat of the following bar (the slot is just before it); as the later
 * end, the last beat of its own bar (just behind it). Where no such beat exists it widens to the
 * whole bar, which the range then covers entirely.
 */
function endAt(score: Score, cursor: EditCursor, earlier: boolean): RangeEnd {
  if (cursor.beat !== undefined) return endOf(cursor);
  const at = resolveCursor(score, cursor);
  const track = at && score.tracks[at.track];
  if (!at || !track) return endOf(cursor);
  if (earlier) {
    const next = track.bars[at.bar + 1]?.voices[at.voice]?.beats[0];
    const masterBar = score.masterBars[at.bar + 1];
    if (next && masterBar) return { track: cursor.track, masterBar: masterBar.id, beat: next.id };
  } else {
    const last = track.bars[at.bar]?.voices[at.voice]?.beats.at(-1);
    if (last) return { track: cursor.track, masterBar: cursor.masterBar, beat: last.id };
  }
  return endOf(cursor);
}

const isBefore = (a: TimePoint | undefined, b: TimePoint | undefined): boolean =>
  a !== undefined && b !== undefined && compare(a, b) < 0;

/** A beats range between two cursors, each end slot resolved by which end is earlier. */
export function rangeBetween(score: Score, from: EditCursor, to: EditCursor): EditRange {
  const a = timeOf(score, from);
  const f = timeOf(score, to);
  return {
    kind: 'beats',
    anchor: endAt(score, from, isBefore(a, f)),
    focus: endAt(score, to, isBefore(f, a)),
  };
}

/** `range` with its focus moved to `to`, the anchor kept. */
function moveFocus(score: Score, range: EditRange, to: EditCursor): EditRange {
  const anchor = endSpan(score, range.anchor);
  return { ...range, focus: endAt(score, to, isBefore(timeOf(score, to), anchor?.start)) };
}

export type ExtendStep =
  Extract<Step, 'previous' | 'next' | 'previousBar' | 'nextBar'> | 'previousTrack' | 'nextTrack';

/**
 * Extends the range with the cursor as its moving end, one `step` at a time (Shift+arrows). The
 * anchor is the existing range's, else the cursor's own place; a bar step makes a `bars` range.
 * Returns the new range and where the cursor goes, or undefined when it cannot move.
 */
export function extendRange(
  score: Score,
  state: Pick<SelectionState, 'cursor' | 'range'>,
  step: ExtendStep,
  visible: readonly Id[],
): { range: EditRange; cursor: EditCursor } | undefined {
  const { cursor } = state;
  if (!cursor) return undefined;
  const kind: EditRange['kind'] = step === 'previousBar' || step === 'nextBar' ? 'bars' : 'beats';
  const next =
    step === 'previousTrack'
      ? moveTrack(score, cursor, visible, -1)
      : step === 'nextTrack'
        ? moveTrack(score, cursor, visible, 1)
        : move(score, cursor, step);
  if (!next) return undefined;
  if (kind === 'beats') {
    const range =
      state.range?.kind === 'beats'
        ? moveFocus(score, state.range, next)
        : rangeBetween(score, cursor, next);
    return { range, cursor: next };
  }
  const anchor = state.range?.kind === kind ? state.range.anchor : endOf(cursor, kind);
  return { range: { kind, anchor, focus: endOf(next, kind) }, cursor: next };
}

/** Extends a beats range to the cursor `to` (Shift+click or a drag), from the existing anchor or the cursor. */
export function extendBeatsTo(
  score: Score,
  state: Pick<SelectionState, 'cursor' | 'range'>,
  to: EditCursor,
): EditRange | undefined {
  if (state.range?.kind === 'beats') return moveFocus(score, state.range, to);
  return state.cursor && rangeBetween(score, state.cursor, to);
}

/** Extends a bars range to `end` (Shift+click on a bar area), from the existing anchor or the cursor. */
export function extendRangeTo(
  state: Pick<SelectionState, 'cursor' | 'range'>,
  end: RangeEnd,
  kind: EditRange['kind'] = 'beats',
): EditRange | undefined {
  const base =
    state.range?.kind === kind ? state.range.anchor : state.cursor && endOf(state.cursor, kind);
  return base && { kind, anchor: base, focus: kind === 'bars' ? { ...end, beat: undefined } : end };
}

/**
 * What a command acts on: the range's beats, else the notes picked, else the note on the
 * cursor's beat and string, else the cursor's beat, else nothing.
 */
export function editTarget(
  score: Score,
  state: Pick<SelectionState, 'cursor' | 'range' | 'selection'>,
  visible?: readonly Id[],
): Selection {
  const { range, selection, cursor } = state;
  if (range) {
    const beatIds = rangeBeats(score, range, visible).flatMap((part) =>
      part.beats.map(({ id }) => id),
    );
    if (beatIds.length > 0) return { beatIds };
  }
  if (selection.noteIds?.length || selection.beatIds?.length) return selection;
  if (!cursor?.beat) return {};
  const at = resolveCursor(score, cursor);
  const beat = at && score.tracks[at.track]?.bars[at.bar]?.voices[at.voice]?.beats[at.stop];
  if (!beat) return {};
  // On a drum track the cursor's lane picks the hit, as its string picks the note on a fretted one.
  const lane =
    score.tracks[at.track]?.kind === 'drums' ? (cursor.pitch ?? DEFAULT_LANE) : undefined;
  const note = beat.notes.find((candidate) =>
    lane === undefined ? candidate.string === cursor.string : candidate.fret === lane,
  );
  return note ? { noteIds: [note.id] } : { beatIds: [beat.id] };
}

/** The cursor at the first onset of a range end's bar or beat in its own track, voice 0, for a drag that ends there. */
export function cursorForEnd(
  score: Score,
  end: RangeEnd,
  base: Pick<EditCursor, 'string' | 'staff'>,
): EditCursor | undefined {
  const index = scoreIndex(score);
  const track = score.tracks.findIndex(({ id }) => id === end.track);
  if (end.beat !== undefined) {
    const info = index.beats.get(end.beat);
    return (
      info &&
      cursorAtPosition(
        score,
        { track: info.trackIndex, bar: info.masterBarIndex, voice: info.voice, stop: info.index },
        base,
      )
    );
  }
  const bar = index.barIndex.get(end.masterBar);
  return bar === undefined || track < 0
    ? undefined
    : cursorAtPosition(score, { track, bar, voice: 0, stop: 0 }, base);
}
