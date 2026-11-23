import { percussionInstrument, type Note, type Track } from '@reprise/model';

import type { EditCursor } from '@/state/selection';

/** The snare: the lane a drum cursor starts on. */
export const DEFAULT_LANE = 38;

/** The highest GM2 percussion key; the lowest is 27. */
export const LAST_DRUM_KEY = 87;

/** The kit the cursor walks before the track uses anything else: kick up to the cymbals. */
const DEFAULT_KIT = [
  36, 38, 37, 42, 44, 46, 41, 43, 45, 47, 48, 50, 49, 57, 51, 53, 52, 55,
] as const;

/** Where layout draws a key the model does not know (`UNMAPPED_POSITION` in the layout package). */
const UNMAPPED_POSITION = 4;

/** The staff position of a drum key, as layout draws it. */
const positionOf = (midi: number): number =>
  percussionInstrument(midi)?.staffPosition ?? UNMAPPED_POSITION;

/** The lane a drum cursor is on: its own, else the snare. */
export const cursorLane = (cursor: Pick<EditCursor, 'pitch'>): number =>
  cursor.pitch ?? DEFAULT_LANE;

/**
 * Whether the cursor sits on a lane (`EditCursor.pitch`) rather than a string: drum tracks, where
 * it is a GM key, and pitched ones, where it is a MIDI key.
 */
export const hasLane = (track: Pick<Track, 'kind'>): boolean => track.kind !== 'fretted';

/**
 * The note of a beat in the cursor's slot: its string on a fretted track, its lane on a drum one,
 * and on a pitched one the note of its key (none while the cursor has not picked a lane).
 */
export function noteAtCursor<T extends Pick<Note, 'string' | 'fret'>>(
  track: Pick<Track, 'kind'>,
  notes: readonly T[],
  cursor: Pick<EditCursor, 'string' | 'pitch'>,
): T | undefined {
  if (track.kind === 'drums') return notes.find((note) => note.fret === cursorLane(cursor));
  if (track.kind === 'pitched') return notes.find((note) => note.fret === cursor.pitch);
  return notes.find((note) => note.string === cursor.string);
}

/**
 * The lanes a drum cursor walks, bottom of the staff first: the default kit plus every
 * articulation the track already uses, by staff position and then by key where several share a
 * line or space.
 */
export function drumLanes(track: Pick<Track, 'bars'>): number[] {
  const keys = new Set<number>(DEFAULT_KIT);
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          if (percussionInstrument(note.fret)) keys.add(note.fret);
        }
      }
    }
  }
  return [...keys].sort((a, b) => positionOf(a) - positionOf(b) || a - b);
}

/**
 * The lane `delta` away from `midi`: -1 up the staff, +1 down, as the string keys count. A key
 * that is not on the list (the last hit of a non-kit drum was deleted, or a file's unknown key)
 * is stepped from where it would sit, so the arrows always move. Undefined at the ends.
 */
export function stepLane(
  track: Pick<Track, 'bars'>,
  midi: number,
  delta: -1 | 1,
): number | undefined {
  const lanes = drumLanes(track);
  if (!lanes.includes(midi)) {
    lanes.push(midi);
    lanes.sort((a, b) => positionOf(a) - positionOf(b) || a - b);
  }
  return lanes[lanes.indexOf(midi) - delta];
}

/**
 * The lane nearest a staff position (0 is the bottom line, 8 the top one), for a click. Of several
 * lanes on one line the `current` one wins, then the snare, then the lowest key.
 */
export function laneNear(
  track: Pick<Track, 'bars'>,
  position: number,
  current: number | undefined,
): number {
  const rank = (lane: number) => (lane === current ? 0 : lane === DEFAULT_LANE ? 1 : 2);
  let best = DEFAULT_LANE;
  let nearest = Number.POSITIVE_INFINITY;
  for (const lane of drumLanes(track)) {
    const distance = Math.abs(positionOf(lane) - position);
    if (distance < nearest || (distance === nearest && rank(lane) < rank(best))) {
      best = lane;
      nearest = distance;
    }
  }
  return best;
}

/** "Acoustic Snare (38)", for the status line and the refusals. */
export function laneLabel(midi: number): string {
  const name = percussionInstrument(midi)?.name;
  return name ? `${name} (${String(midi)})` : `Key ${String(midi)}`;
}

/** The position on the percussion staff a lane's hits are drawn at. */
export const lanePosition = positionOf;
