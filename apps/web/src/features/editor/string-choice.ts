import { maxStoredFret, openStringPitch, writtenFret, type Note, type Track } from '@reprise/model';

type NeckTrack = Pick<Track, 'tuning' | 'fretCount' | 'capo' | 'drone'>;

export interface Position {
  string: number;
  fret: number;
}

/**
 * Where `pitch` can be played on a neck, string 1 first, with frets counting from the capo as the
 * model's `midiNote` does. Only the notated strings count: a doubled course (a 12-string, a
 * mandolin) sounds its second string from the first, so it is no place of its own. Paste
 * re-fingering and note entry both read this, so they agree on what is playable.
 */
export function neckPositions(track: NeckTrack, pitch: number): Position[] {
  const found: Position[] = [];
  for (let string = 1; string <= track.tuning.length; string++) {
    const open = openStringPitch(track, string);
    if (open === undefined) continue;
    const fret = pitch - open - track.capo;
    if (fret >= 0 && fret <= maxStoredFret(track, string)) found.push({ string, fret });
  }
  return found;
}

/** The lowest and highest pitch the neck sounds, or undefined for a track with no strings. */
export function neckRange(track: NeckTrack): { lowest: number; highest: number } | undefined {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let string = 1; string <= track.tuning.length; string++) {
    const open = openStringPitch(track, string);
    if (open === undefined) continue;
    lowest = Math.min(lowest, open + track.capo);
    highest = Math.max(highest, open + track.capo + maxStoredFret(track, string));
  }
  return lowest <= highest ? { lowest, highest } : undefined;
}

/**
 * Where the hand is: the neck fret (as printed, so a banjo's drone string counts from the neck's
 * nut) of the previous note on `string`, else its lowest fret above the nut, else the nut.
 */
export function handPosition(
  track: Pick<Track, 'drone'>,
  previous: readonly Pick<Note, 'string' | 'fret'>[] | undefined,
  string: number,
): number {
  if (!previous || previous.length === 0) return 0;
  const written = previous.map((note) => ({
    string: note.string,
    fret: writtenFret(track, note),
  }));
  const same = written.find((note) => note.string === string);
  if (same) return same.fret;
  const fretted = written.filter(({ fret }) => fret > 0).map(({ fret }) => fret);
  return fretted.length > 0 ? Math.min(...fretted) : 0;
}

export interface ChoiceOptions {
  /** Strings that already hold another note of the beat. */
  taken: ReadonlySet<number>;
  /** The fret the hand is at, as `handPosition` finds it. */
  hand: number;
  /** The cursor's string, which wins a tie. */
  preferred: number;
}

/**
 * The string a pitch goes on: of the free strings that can play it, the fret nearest the hand, so
 * a phrase stays in position (the lowest fret when the hand is at the nut). A tie goes to the
 * cursor's string, then to the higher string, the lower number.
 */
export function chooseString(
  track: NeckTrack,
  pitch: number,
  { taken, hand, preferred }: ChoiceOptions,
): Position | undefined {
  let best: Position | undefined;
  let bestKey: [number, number, number] | undefined;
  for (const position of neckPositions(track, pitch)) {
    if (taken.has(position.string)) continue;
    const distance = Math.abs(writtenFret(track, position) - hand);
    const key: [number, number, number] = [
      distance,
      position.string === preferred ? 0 : 1,
      position.string,
    ];
    if (
      !bestKey ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] &&
        (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
    ) {
      best = position;
      bestKey = key;
    }
  }
  return best;
}
