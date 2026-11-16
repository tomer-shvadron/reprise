import type { Command } from '@/app/command-registry';

import {
  canMoveTrack,
  currentTrackOf,
  moveTrackBy,
  openAddTrack,
  openTrackProperties,
  removeBlocker,
  requestRemoveTrack,
  type TrackEditServices,
} from './track-edit';

export type TrackEditCommandId =
  | 'track.properties'
  | 'track.add'
  | 'track.addWindows'
  | 'track.remove'
  | 'track.moveUp'
  | 'track.moveDown';

type TrackEditCommand = Command & { id: TrackEditCommandId };

/**
 * Track management, global like the other track commands. Remove and move have no keys, so a
 * destructive key never sits near the note-entry keys (decision 11c); the sidebar menu reaches
 * them by pointer and keyboard.
 */
export function trackEditCommands(services: TrackEditServices): TrackEditCommand[] {
  const onCurrent = (run: (id: string) => void) => () => {
    const track = currentTrackOf(services);
    if (track) run(track.id);
  };
  const canMove = (delta: -1 | 1) => () => {
    const track = currentTrackOf(services);
    return track !== undefined && canMoveTrack(services, track.id, delta);
  };
  const add = () => {
    openAddTrack(services);
  };
  return [
    {
      id: 'track.properties',
      title: 'Track properties…',
      // Guitar Pro's Track Inspector.
      shortcut: { key: 'F6' },
      run: () => {
        openTrackProperties(services);
      },
    },
    {
      id: 'track.add',
      title: 'Add track…',
      // Guitar Pro's keys; Ctrl+Alt+N is AltGr+N on some Windows layouts, so Windows differs.
      shortcut: { key: 'n', mod: true, alt: true, only: 'mac' },
      run: add,
    },
    {
      id: 'track.addWindows',
      title: 'Add track…',
      shortcut: { key: 'Insert', mod: true, shift: true, only: 'other' },
      inPalette: false,
      run: add,
    },
    {
      id: 'track.remove',
      title: 'Remove track…',
      // A score keeps at least one track.
      enabled: () => removeBlocker(services) === undefined,
      run: () => {
        requestRemoveTrack(services);
      },
    },
    {
      id: 'track.moveUp',
      title: 'Move track up',
      enabled: canMove(-1),
      run: onCurrent((id) => {
        moveTrackBy(services, id, -1);
      }),
    },
    {
      id: 'track.moveDown',
      title: 'Move track down',
      enabled: canMove(1),
      run: onCurrent((id) => {
        moveTrackBy(services, id, 1);
      }),
    },
  ];
}
