import type { StaffType } from '@reprise/layout';
import {
  barTicks,
  beatTicks,
  canShowTab,
  shownNotation,
  type Id,
  type Notation,
  type Score,
  type Selection,
  type Track,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { EditCursor, EditRange, RangeEnd, SelectionState } from '@/state/selection';

import { hasLane } from './drum-lanes';
import { clefOf, middleLine } from './pitch-entry';

const EPSILON = 1e-6;

/** A position in the score, by indices. `stop` indexes a voice's stops: its beats, then the end slot. */
export interface Position {
  track: number;
  bar: number;
  voice: number;
  stop: number;
}

/** How many strings a track's notes sit on; 0 for a track without them. */
export function stringCount(score: Score, track: number): number {
  const found = score.tracks[track];
  return found && canShowTab(found) ? found.tuning.length : 0;
}

/** 1 to the string count, or 0 on a track without strings. */
export function clampString(score: Score, track: number, string: number): number {
  const count = stringCount(score, track);
  return count === 0 ? 0 : Math.min(Math.max(Math.round(string), 1), count);
}

/**
 * The stops of a voice: each beat, then the slot after the last beat unless the bar is full. An
 * empty voice has exactly one, its end slot. A voice a bar lacks counts as empty.
 */
export function stopCount(score: Score, track: number, bar: number, voice: number): number {
  const beats = score.tracks[track]?.bars[bar]?.voices[voice]?.beats ?? [];
  const masterBar = score.masterBars[bar];
  if (!masterBar) return beats.length;
  let total = 0;
  for (const beat of beats) total += beatTicks(beat);
  return beats.length + (total < barTicks(masterBar) - EPSILON ? 1 : 0);
}

/** The beat id at a stop; undefined for the end slot. */
function beatAt(score: Score, p: Position): Id | undefined {
  return score.tracks[p.track]?.bars[p.bar]?.voices[p.voice]?.beats[p.stop]?.id;
}

function laneOn(track: Track, bar: number, wanted: number | undefined): number | undefined {
  if (!hasLane(track)) return undefined;
  if (wanted !== undefined || track.kind === 'drums') return wanted;
  return middleLine(clefOf(track, bar), track.display.octaveShift);
}

/** The cursor at `p`, keeping the string and staff of `base`; undefined when `p` names no stop. */
export function cursorAtPosition(
  score: Score,
  p: Position,
  base: Pick<EditCursor, 'string' | 'staff' | 'pitch'>,
): EditCursor | undefined {
  const track = score.tracks[p.track];
  const masterBar = score.masterBars[p.bar];
  if (!track || !masterBar || p.stop < 0 || p.stop >= stopCount(score, p.track, p.bar, p.voice)) {
    return undefined;
  }
  const beat = beatAt(score, p);
  const lane = laneOn(track, p.bar, base.pitch);
  return {
    track: track.id,
    masterBar: masterBar.id,
    voice: p.voice,
    beat,
    string: clampString(score, p.track, base.string || 1),
    // The lane belongs to a track without strings; a pitched one always has it, on the clef's
    // middle line until the cursor picks another.
    ...(lane !== undefined && { pitch: lane }),
    staff: base.staff,
    at: { track: p.track, bar: p.bar, beat: p.stop },
  };
}

/**
 * Which staff a new cursor on `track` sits on before anything says: the one the user sees first in
 * the notation shown (`wanted`, else the track's own): standard in standard notation, tab in tab
 * and in both (where the tab staff is the editing one), percussion on a drum track.
 */
export function defaultStaff(score: Score, track: number, wanted?: Notation): StaffType {
  const found = score.tracks[track];
  if (!found) return 'standard';
  if (found.kind === 'drums') return 'percussion';
  return shownNotation(found, wanted ?? found.display.notation) === 'standard' ? 'standard' : 'tab';
}

/** Ticks from the start of its bar to the cursor's stop, in its voice; undefined for a cursor the score does not hold. */
export function cursorTick(score: Score, cursor: EditCursor): number | undefined {
  const at = resolveCursor(score, cursor);
  if (!at) return undefined;
  const beats = score.tracks[at.track]?.bars[at.bar]?.voices[at.voice]?.beats ?? [];
  return beats.slice(0, at.stop).reduce((sum, beat) => sum + beatTicks(beat), 0);
}

/** The first stop of `track`'s bar `bar` in `voice`. */
export function firstStop(
  score: Score,
  track: number,
  bar: number,
  voice = 0,
  base?: Pick<EditCursor, 'string' | 'staff' | 'pitch'>,
): EditCursor | undefined {
  return cursorAtPosition(
    score,
    { track, bar, voice, stop: 0 },
    base ?? { string: 1, staff: defaultStaff(score, track) },
  );
}

export interface Resolved extends Position {
  /** Where the cursor stood before it was resolved; false when the score no longer holds all of it. */
  exact: boolean;
}

/**
 * The indices of a cursor in `score`: by ids while they all still resolve, else by the `at` it
 * last held, clamped. Undefined only for a score with no tracks or bars.
 */
export function resolveCursor(score: Score, cursor: EditCursor): Resolved | undefined {
  const index = scoreIndex(score);
  const track = score.tracks.findIndex((candidate) => candidate.id === cursor.track);
  const bar = index.barIndex.get(cursor.masterBar);
  if (track >= 0 && bar !== undefined) {
    const stops = stopCount(score, track, bar, cursor.voice);
    if (cursor.beat === undefined) {
      const last = stops - 1;
      const hasEnd =
        last >= (score.tracks[track]?.bars[bar]?.voices[cursor.voice]?.beats.length ?? 0);
      if (hasEnd) return { track, bar, voice: cursor.voice, stop: last, exact: true };
    } else {
      const beat = index.beats.get(cursor.beat);
      if (
        beat?.trackIndex === track &&
        beat.masterBarIndex === bar &&
        beat.voice === cursor.voice
      ) {
        return { track, bar, voice: cursor.voice, stop: beat.index, exact: true };
      }
    }
  }
  return clampedPosition(score, cursor);
}

function clampedPosition(score: Score, cursor: EditCursor): Resolved | undefined {
  const lastTrack = score.tracks.length - 1;
  const lastBar = score.masterBars.length - 1;
  if (lastTrack < 0 || lastBar < 0) return undefined;
  const trackFound = score.tracks.findIndex((candidate) => candidate.id === cursor.track);
  const track = trackFound >= 0 ? trackFound : Math.min(Math.max(cursor.at.track, 0), lastTrack);
  const barFound = scoreIndex(score).barIndex.get(cursor.masterBar);
  const barGone = barFound === undefined;
  const bar = barFound ?? Math.min(Math.max(cursor.at.bar, 0), lastBar);
  const voice = Math.min(Math.max(cursor.voice, 0), 3);
  const stops = stopCount(score, track, bar, voice);
  const wanted = barGone ? 0 : cursor.at.beat;
  return {
    track,
    bar,
    voice,
    stop: Math.min(Math.max(wanted, 0), Math.max(stops - 1, 0)),
    exact: false,
  };
}

/**
 * The cursor on the beat of `track` sounding `tick` ticks into bar `bar`, in `voice`: the last
 * beat that has started, the end slot past the last one, a rest's start inside it.
 */
export function cursorAtTick(
  score: Score,
  track: number,
  bar: number,
  tick: number,
  voice: number,
  base?: Pick<EditCursor, 'string' | 'staff' | 'pitch'>,
): EditCursor | undefined {
  const beats = score.tracks[track]?.bars[bar]?.voices[voice]?.beats ?? [];
  const stops = stopCount(score, track, bar, voice);
  let start = 0;
  let stop = 0;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (!beat) break;
    const end = start + beatTicks(beat);
    if (tick < end - EPSILON || i === beats.length - 1) {
      // Past the last beat, the end slot, when the bar has one.
      stop = tick >= end - EPSILON && i === beats.length - 1 && stops > beats.length ? i + 1 : i;
      break;
    }
    start = end;
  }
  const fallback = base ?? { string: 1, staff: defaultStaff(score, track) };
  return cursorAtPosition(score, { track, bar, voice, stop }, fallback);
}

const sameEnd = (a: RangeEnd, b: RangeEnd) =>
  a.track === b.track && a.masterBar === b.masterBar && a.beat === b.beat;

function sameCursor(a: EditCursor, b: EditCursor): boolean {
  return (
    a.track === b.track &&
    a.masterBar === b.masterBar &&
    a.voice === b.voice &&
    a.beat === b.beat &&
    a.string === b.string &&
    a.pitch === b.pitch &&
    a.staff === b.staff &&
    a.at.track === b.at.track &&
    a.at.bar === b.at.bar &&
    a.at.beat === b.at.beat
  );
}

type EditState = Pick<SelectionState, 'cursor' | 'range' | 'selection' | 'currentTrack'>;
export type EditPatch = Parameters<SelectionState['setEdit']>[0];

function reconcileEnd(score: Score, end: RangeEnd): RangeEnd | undefined {
  const index = scoreIndex(score);
  if (!index.barIndex.has(end.masterBar) || !score.tracks.some((track) => track.id === end.track)) {
    return undefined;
  }
  if (end.beat === undefined || index.beats.has(end.beat)) return end;
  return { ...end, beat: undefined };
}

/**
 * What to write to the store so its cursor, range and picked ids hold only what `score` still
 * has, or undefined when nothing changes. A beat that is gone moves the cursor to the stop at its
 * old index (undo brings the beat back with its id; `undoLanding` then moves the cursor onto it,
 * which `installEditor` does before it reconciles); a bar that is gone
 * to the first stop of the bar at its old index; a range end whose beat is gone widens to its bar.
 */
export function reconcile(score: Score, state: EditState): EditPatch | undefined {
  const patch: EditPatch = {};
  const { cursor } = state;
  if (cursor) {
    const resolved = resolveCursor(score, cursor);
    const track = resolved && score.tracks[resolved.track];
    const next =
      resolved &&
      track &&
      cursorAtPosition(score, resolved, {
        string: clampString(score, resolved.track, cursor.string),
        ...(cursor.pitch !== undefined && { pitch: cursor.pitch }),
        staff: cursor.staff,
      });
    if (!next) {
      patch.cursor = undefined;
    } else {
      // A cursor that cannot stay on its staff (the track no longer has strings) takes a staff it has.
      const staff =
        next.staff === 'tab' && stringCount(score, resolved.track) === 0
          ? defaultStaff(score, resolved.track)
          : next.staff;
      const settled = staff === next.staff ? next : { ...next, staff };
      if (!sameCursor(cursor, settled)) patch.cursor = settled;
      if (track.id !== state.currentTrack && settled.track !== cursor.track) {
        patch.currentTrack = track.id;
      }
    }
  }

  const { range } = state;
  if (range) {
    const anchor = reconcileEnd(score, range.anchor);
    const focus = reconcileEnd(score, range.focus);
    if (!anchor || !focus) {
      patch.range = undefined;
      patch.bars = undefined;
      patch.barsAnchor = undefined;
    } else if (!sameEnd(anchor, range.anchor) || !sameEnd(focus, range.focus)) {
      const widened: EditRange = { ...range, anchor, focus };
      patch.range = widened;
    }
  }

  const { noteIds, beatIds } = state.selection;
  const index = scoreIndex(score);
  const notes = noteIds?.filter((id) => index.noteBeat.has(id));
  const beats = beatIds?.filter((id) => index.beats.has(id));
  if (notes?.length !== noteIds?.length || beats?.length !== beatIds?.length) {
    const kept: Selection = {};
    if (notes?.length) kept.noteIds = notes;
    if (beats?.length) kept.beatIds = beats;
    patch.selection = kept;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}
