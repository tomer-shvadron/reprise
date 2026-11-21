import type { Track } from '@reprise/model';

import type { AppServices } from '@/app/services';
import type { MenuTarget } from '@/state/menu-target';

type TargetServices = Pick<AppServices, 'document' | 'selection' | 'menuTarget'>;

/**
 * The track a track command acts on: the one a context menu was opened on (a track row or a
 * mixer strip), else the current track. Read before the command's first `await`, as the target is
 * cleared once the menu's command returns.
 */
export function targetTrackOf(services: TargetServices): Track | undefined {
  return trackOfTarget(services, services.menuTarget.getState().target);
}

/** The same rule for a menu's own predicates, which get the target they were resolved for. */
export function trackOfTarget(
  services: Pick<AppServices, 'document' | 'selection'>,
  target: MenuTarget | undefined,
): Track | undefined {
  const { score } = services.document.getState();
  const id = target?.kind === 'track' ? target.track : services.selection.getState().currentTrack;
  return score?.tracks.find((track) => track.id === id);
}
