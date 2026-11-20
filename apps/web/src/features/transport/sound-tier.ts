import type { Id } from '@reprise/model';

import type { TrackSound } from '@/state/playback';

/** `GM`, `HQ` or `GM + HQ` over the song's tracks; a track with no entry plays the soundfont. */
export function soundTierLabel(
  trackIds: readonly Id[],
  trackSounds: Readonly<Record<Id, TrackSound>>,
): 'GM' | 'HQ' | 'GM + HQ' {
  const tiers = new Set(trackIds.map((id) => trackSounds[id]?.tier ?? 'gm'));
  if (tiers.has('hq')) return tiers.has('gm') ? 'GM + HQ' : 'HQ';
  return 'GM';
}
