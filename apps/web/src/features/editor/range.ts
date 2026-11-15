import { beatTicks, type Beat, type Id, type Score, type Selection } from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { BarRange, EditCursor, EditRange, RangeEnd, SelectionState } from '@/state/selection';

import { cursorAtPosition, resolveCursor } from './cursor';
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
function endSpan(score: Score, end: RangeEnd): { start: TimePoint; end: TimePoint } | undefined {
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

/** The end of a range a cursor stands for: its beat, or its whole bar when it is on an end slot or `kind` is bars. */
export function endOf(cursor: EditCursor, kind: EditRange['kind'] = 'beats'): RangeEnd {
  return {
    track: cursor.track,
    masterBar: cursor.masterBar,
    beat: kind === 'bars' ? undefined : cursor.beat,
  };
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
  const anchor = state.range?.kind === kind ? state.range.anchor : endOf(cursor, kind);
  return { range: { kind, anchor, focus: endOf(next, kind) }, cursor: next };
}

/** Extends the range to `end` (Shift+click), from the existing anchor or the cursor. */
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
  const note = beat.notes.find((candidate) => candidate.string === cursor.string);
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
