import type { LayoutResult } from '@reprise/layout';
import { beatTicks, type Id, type Score } from '@reprise/model';

import type { EditCursor } from '@/state/selection';

import {
  clampString,
  cursorAtPosition,
  cursorAtTick,
  defaultStaff,
  resolveCursor,
  stopCount,
  stringCount,
} from './cursor';

export type Step =
  | 'previous'
  | 'next'
  | 'barStart'
  | 'barEnd'
  | 'previousBar'
  | 'nextBar'
  | 'scoreStart'
  | 'scoreEnd';

/**
 * The cursor `step` away, within its track and voice, walking its stops bar after bar; undefined
 * where it cannot go (the first stop, the last), or when the cursor names nothing in the score.
 */
export function move(score: Score, cursor: EditCursor, step: Step): EditCursor | undefined {
  const at = resolveCursor(score, cursor);
  if (!at) return undefined;
  const { track, voice } = at;
  const lastBar = score.masterBars.length - 1;
  const lastStop = (bar: number) => Math.max(stopCount(score, track, bar, voice) - 1, 0);
  const to = (bar: number, stop: number) =>
    cursorAtPosition(score, { track, bar, voice, stop }, cursor);
  switch (step) {
    case 'next':
      if (at.stop < lastStop(at.bar)) return to(at.bar, at.stop + 1);
      return at.bar < lastBar ? to(at.bar + 1, 0) : undefined;
    case 'previous':
      if (at.stop > 0) return to(at.bar, at.stop - 1);
      return at.bar > 0 ? to(at.bar - 1, lastStop(at.bar - 1)) : undefined;
    case 'barStart':
      return at.stop > 0 ? to(at.bar, 0) : undefined;
    case 'barEnd':
      return at.stop < lastStop(at.bar) ? to(at.bar, lastStop(at.bar)) : undefined;
    case 'previousBar':
      return at.bar > 0 ? to(at.bar - 1, 0) : undefined;
    case 'nextBar':
      return at.bar < lastBar ? to(at.bar + 1, 0) : undefined;
    case 'scoreStart':
      return at.bar > 0 || at.stop > 0 ? to(0, 0) : undefined;
    case 'scoreEnd':
      return at.bar < lastBar || at.stop < lastStop(lastBar)
        ? to(lastBar, lastStop(lastBar))
        : undefined;
  }
}

/** The cursor one string up (`delta` -1, towards string 1) or down (+1); undefined without strings or at the end. */
export function moveString(
  score: Score,
  cursor: EditCursor,
  delta: -1 | 1,
): EditCursor | undefined {
  const at = resolveCursor(score, cursor);
  if (!at || stringCount(score, at.track) === 0) return undefined;
  const string = clampString(score, at.track, cursor.string + delta);
  return string === cursor.string ? undefined : { ...cursor, string };
}

/**
 * The cursor on the visible track `delta` tracks away, at the same bar and onset, in its voice.
 * Undefined at the first or last visible track.
 */
export function moveTrack(
  score: Score,
  cursor: EditCursor,
  visible: readonly Id[],
  delta: -1 | 1,
): EditCursor | undefined {
  const at = resolveCursor(score, cursor);
  if (!at) return undefined;
  const target = visible[visible.indexOf(cursor.track) + delta];
  const track = score.tracks.findIndex((candidate) => candidate.id === target);
  if (target === undefined || track < 0 || visible.indexOf(cursor.track) < 0) return undefined;
  const beats = score.tracks[at.track]?.bars[at.bar]?.voices[at.voice]?.beats ?? [];
  const tick = beats.slice(0, at.stop).reduce((sum, beat) => sum + beatTicks(beat), 0);
  const next = cursorAtTick(score, track, at.bar, tick, at.voice, {
    string: cursor.string,
    staff: cursor.staff,
  });
  return next && { ...next, staff: staffOn(score, track, cursor) };
}

/** The cursor's staff, kept when the new track can show it. */
function staffOn(score: Score, track: number, cursor: EditCursor): EditCursor['staff'] {
  if (score.tracks[track]?.kind === 'drums') return 'percussion';
  if (cursor.staff === 'tab' && stringCount(score, track) > 0) return 'tab';
  return cursor.staff === 'standard' ? 'standard' : defaultStaff(score, track);
}

/**
 * The first stop of the bar in the previous (`-1`) or next (`+1`) system, the same voice and
 * string: a continuous layout's segment counts as a system. Undefined at the first or last.
 */
export function movePage(
  score: Score,
  cursor: EditCursor,
  layout: LayoutResult,
  delta: -1 | 1,
): EditCursor | undefined {
  const at = resolveCursor(score, cursor);
  if (!at) return undefined;
  const { systems } = layout;
  const here = systems.find((system) => system.bars.start <= at.bar && at.bar < system.bars.end);
  if (!here) return undefined;
  let bar: number | undefined;
  if (delta > 0) {
    // A split system's parts share their bars, so the next system starts after all of them.
    const end = Math.max(
      ...systems.filter((s) => s.bars.start === here.bars.start).map((s) => s.bars.end),
    );
    bar = end < score.masterBars.length ? end : undefined;
  } else {
    bar = systems.reduce<number | undefined>(
      (best, s) =>
        s.bars.start < here.bars.start && (best === undefined || s.bars.start > best)
          ? s.bars.start
          : best,
      undefined,
    );
  }
  if (bar === undefined) return undefined;
  return cursorAtPosition(score, { track: at.track, bar, voice: at.voice, stop: 0 }, cursor);
}
