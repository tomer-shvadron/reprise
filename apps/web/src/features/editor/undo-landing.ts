import type { Id, Patch, Score } from '@reprise/model';

import type { EditCursor } from '@/state/selection';

import { cursorAtPosition, resolveCursor, stopCount } from './cursor';

/** Where in the score one patch's path points; what is missing from the path is undefined. */
interface Spot {
  track?: number;
  bar?: number;
  voice?: number;
  beat?: number;
  note?: number;
  masterBar?: number;
}

/** The levels a patch path names, or undefined when it names none of them. */
function spotOf(path: Patch['path']): Spot | undefined {
  const spot: Spot = {};
  const [root, first] = path;
  if (root === 'masterBars' && typeof first === 'number') return { masterBar: first };
  if (root !== 'tracks' || typeof first !== 'number') return undefined;
  spot.track = first;
  const levels = ['bars', 'voices', 'beats', 'notes'] as const;
  const keys = { bars: 'bar', voices: 'voice', beats: 'beat', notes: 'note' } as const;
  let at = 2;
  for (const level of levels) {
    const index = path[at + 1];
    if (path[at] !== level || typeof index !== 'number') break;
    spot[keys[level]] = index;
    at += 2;
  }
  return spot;
}

/** Whether `a` is earlier in the score than `b`: by bar, then voice, then beat. */
function before(a: Spot, b: Spot): boolean {
  const key = (spot: Spot) => [spot.bar ?? spot.masterBar ?? 0, spot.voice ?? 0, spot.beat ?? 0];
  const [ab = 0, av = 0, at = 0] = key(a);
  const [bb = 0, bv = 0, bt = 0] = key(b);
  return ab !== bb ? ab < bb : av !== bv ? av < bv : at < bt;
}

/** The depth a spot reaches, for deciding whether a removal there leaves a place to land. */
function reach(spot: Spot): 'masterBar' | 'track' | 'bar' | 'voice' | 'beat' | 'note' {
  if (spot.masterBar !== undefined) return 'masterBar';
  if (spot.note !== undefined) return 'note';
  if (spot.beat !== undefined) return 'beat';
  if (spot.voice !== undefined) return 'voice';
  if (spot.bar !== undefined) return 'bar';
  return 'track';
}

/**
 * The cursor an undo or redo should leave behind, read from the patches it replayed: the first
 * patch under the cursor's track, else under any of `visible` (track ids); of the patches on
 * that track, the earliest in the score. A beat path gives that
 * beat (for an undone delete, the beat that came back), a note path also its string, a bar or
 * voice path the first stop of that bar, a master-bar path the first stop of that bar in the
 * cursor's track. A removed beat leaves its stop (the one that took its place); a patch that
 * removes a bar, voice or master bar, or edits a track's own properties, says nothing. Undefined means: leave the cursor to `reconcile`.
 */
export function undoLanding(
  score: Score,
  patches: readonly Patch[],
  cursor: EditCursor,
  visible: readonly Id[],
): EditCursor | undefined {
  const home = resolveCursor(score, cursor);
  if (!home) return undefined;
  const ownTrack = home.track;
  const visibleIndexes = new Set(
    visible.flatMap((id) => {
      const index = score.tracks.findIndex((track) => track.id === id);
      return index < 0 ? [] : [index];
    }),
  );
  const spots: Spot[] = [];
  for (const patch of patches) {
    const spot = spotOf(patch.path);
    if (!spot) continue;
    const depth = reach(spot);
    // A removed bar, voice or master bar is gone; a removed beat leaves its index, a note its beat.
    if (patch.op === 'remove' && depth !== 'note' && depth !== 'beat') continue;
    // A bar or voice that is only a property of the track (no bar level) is no position.
    if (depth === 'track') continue;
    spots.push(spot);
  }
  const first =
    spots.find((spot) => spot.track === ownTrack) ??
    spots.find((spot) => spot.masterBar !== undefined) ??
    spots.find((spot) => spot.track !== undefined && visibleIndexes.has(spot.track));
  if (!first) return undefined;
  // A grouped edit (a paste) patches many places and not in score order: land on the earliest.
  const chosen = spots
    .filter((spot) => spot.track === first.track)
    .reduce((best, spot) => (before(spot, best) ? spot : best));

  const track = chosen.track ?? ownTrack;
  const bar = chosen.bar ?? chosen.masterBar;
  if (bar === undefined) return undefined;
  const voice = chosen.voice ?? (track === ownTrack ? home.voice : 0);
  const base = { string: cursor.string, staff: cursor.staff };
  if (chosen.beat === undefined) {
    return cursorAtPosition(score, { track, bar, voice, stop: 0 }, base);
  }
  const beat = score.tracks[track]?.bars[bar]?.voices[voice]?.beats[chosen.beat];
  const stop = Math.min(chosen.beat, Math.max(stopCount(score, track, bar, voice) - 1, 0));
  const noteString = chosen.note === undefined ? undefined : beat?.notes[chosen.note]?.string;
  return cursorAtPosition(
    score,
    { track, bar, voice, stop },
    { string: noteString ?? base.string, staff: base.staff },
  );
}
