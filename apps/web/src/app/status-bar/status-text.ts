import type { Id } from '@reprise/model';

import type { TrackSound } from '@/state/playback';

export interface SavedState {
  hasScore: boolean;
  dirty: boolean;
  saving: boolean;
}

/** `Saved`, `Unsaved` or `Saving…`; nothing without a song. */
export function savedLabel({ hasScore, dirty, saving }: SavedState): string | undefined {
  if (!hasScore) return undefined;
  if (saving) return 'Saving…';
  return dirty ? 'Unsaved' : 'Saved';
}

export interface LibraryState {
  hasScore: boolean;
  /** The library song the open document is tied to. */
  songId: Id | undefined;
  /** The document came from a file, so "not in library" is something the user can act on. */
  hasFile: boolean;
  importer: { phase: 'idle' | 'running' | 'done'; total: number; done: number };
}

/** The import's progress while it runs, else whether the open song is in the library. */
export function libraryLabel({ hasScore, songId, hasFile, importer }: LibraryState) {
  if (importer.phase === 'running') {
    return `Importing ${String(importer.done)} of ${String(importer.total)}`;
  }
  if (!hasScore) return undefined;
  if (songId !== undefined) return 'In library';
  return hasFile ? 'Not in library' : undefined;
}

/** `GM`, `HQ` or `GM + HQ` over the song's tracks; a track with no entry plays the soundfont. */
export function soundTierLabel(
  trackIds: readonly Id[],
  trackSounds: Readonly<Record<Id, TrackSound>>,
): 'GM' | 'HQ' | 'GM + HQ' {
  const tiers = new Set(trackIds.map((id) => trackSounds[id]?.tier ?? 'gm'));
  if (tiers.has('hq')) return tiers.has('gm') ? 'GM + HQ' : 'HQ';
  return 'GM';
}
