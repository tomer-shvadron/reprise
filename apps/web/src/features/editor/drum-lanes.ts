import { percussionInstrument, type Track } from '@reprise/model';

/** The snare: the lane a drum cursor starts on. */
export const DEFAULT_LANE = 38;

/** The highest GM2 percussion key; the lowest is 27. */
export const LAST_DRUM_KEY = 87;

/** The kit the cursor walks before the track uses anything else: kick up to the cymbals. */
const DEFAULT_KIT = [
  36, 38, 37, 42, 44, 46, 41, 43, 45, 47, 48, 50, 49, 57, 51, 53, 52, 55,
] as const;

/** The staff position of a drum key; keys the model does not know sort with the snare. */
const positionOf = (midi: number): number => percussionInstrument(midi)?.staffPosition ?? 5;

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
 * The lane `delta` away from `midi`: -1 up the staff, +1 down, as the string keys count. It stops
 * at the ends of the list; undefined there, or when `midi` is not a drum key.
 */
export function stepLane(
  track: Pick<Track, 'bars'>,
  midi: number,
  delta: -1 | 1,
): number | undefined {
  const lanes = drumLanes(track);
  const from = lanes.indexOf(midi);
  if (from < 0) return undefined;
  return lanes[from - delta];
}

/**
 * The lane nearest a staff position (0 is the bottom line, 8 the top one), for a click. Of several
 * lanes on one line the `current` one wins, else the first in the list.
 */
export function laneNear(
  track: Pick<Track, 'bars'>,
  position: number,
  current: number | undefined,
): number {
  let best = DEFAULT_LANE;
  let nearest = Number.POSITIVE_INFINITY;
  for (const lane of drumLanes(track)) {
    const distance = Math.abs(positionOf(lane) - position);
    const ties = distance === nearest && lane === current;
    if (distance < nearest || ties) {
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
