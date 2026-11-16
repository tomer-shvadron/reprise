import type { Id, Track } from '@reprise/model';

/**
 * The one rule for a track's tier, shared by the engine and the web layer: a track is HQ when a
 * pack assignment names it, and GM otherwise. A track that only names a pack in `sound.packId`
 * (not installed, or not loaded) is still GM: it plays the soundfont.
 */
export function tierOf(track: Track, packs: readonly { trackId: Id }[]): 'gm' | 'hq' {
  return packs.some((pack) => pack.trackId === track.id) ? 'hq' : 'gm';
}
