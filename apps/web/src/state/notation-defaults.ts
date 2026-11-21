import { isVocalTrack, type Id, type Notation, type Score, type Track } from '@reprise/model';

/** Plain data, so it survives the structured clone to the import worker. */
export interface NotationDefaults {
  strings: Notation;
  vocals: Notation;
}

/** undefined for drums and pitched tracks: they keep the reader's `standard`, they cannot show tab. */
export function defaultNotationOf(
  track: Pick<Track, 'kind' | 'program' | 'name'>,
  defaults: NotationDefaults,
): Notation | undefined {
  if (track.kind !== 'fretted') return undefined;
  return isVocalTrack(track) ? defaults.vocals : defaults.strings;
}

/** A new score with `display.notation` set on the listed tracks; the same score when nothing changes. */
export function applyNotationDefaults(
  score: Score,
  ids: readonly Id[] | undefined,
  defaults: NotationDefaults,
): Score {
  if (!ids || ids.length === 0) return score;
  const listed = new Set(ids);
  const tracks = score.tracks.map((track) => {
    const notation = listed.has(track.id) ? defaultNotationOf(track, defaults) : undefined;
    if (notation === undefined || notation === track.display.notation) return track;
    return { ...track, display: { ...track.display, notation } };
  });
  return tracks.some((track, index) => track !== score.tracks[index])
    ? { ...score, tracks }
    : score;
}
