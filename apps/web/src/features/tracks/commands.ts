import type { Notation } from '@reprise/model';

import type { Command } from '@/app/command-registry';

import {
  clearMuteSolo,
  setTrackNotation,
  showAllTracks,
  stepTrack,
  toggleMultitrack,
  toggleMute,
  toggleSolo,
  type TrackServices,
} from './track-actions';

export type TrackCommandId =
  | 'track.previous'
  | 'track.next'
  | 'view.toggleMultitrack'
  | 'track.toggleMute'
  | 'track.toggleSolo'
  | 'track.clearMuteSolo'
  | 'track.showAll'
  | 'track.notationTab'
  | 'track.notationStandard'
  | 'track.notationBoth';

type TrackCommand = Command & { id: TrackCommandId };

export function trackCommands(services: TrackServices): TrackCommand[] {
  const { document, selection } = services;
  const current = () => {
    const id = selection.getState().currentTrack;
    return document.getState().score?.tracks.find((track) => track.id === id);
  };
  const onCurrent = (run: (id: string) => void) => () => {
    const track = current();
    if (track) run(track.id);
  };
  const notation = (choice: Notation) =>
    onCurrent((id) => {
      setTrackNotation(services, id, choice);
    });

  return [
    {
      id: 'track.previous',
      title: 'Previous track',
      shortcut: { key: 'ArrowUp', mod: true },
      run: () => {
        stepTrack(services, -1);
      },
    },
    {
      id: 'track.next',
      title: 'Next track',
      shortcut: { key: 'ArrowDown', mod: true },
      run: () => {
        stepTrack(services, 1);
      },
    },
    {
      id: 'view.toggleMultitrack',
      title: 'Toggle multitrack view',
      // Guitar Pro's "Multitrack".
      shortcut: { key: 'F3' },
      run: () => {
        toggleMultitrack(services);
      },
    },
    {
      id: 'track.toggleMute',
      title: 'Mute or unmute current track',
      run: onCurrent((id) => {
        toggleMute(services, id);
      }),
    },
    {
      id: 'track.toggleSolo',
      title: 'Solo or unsolo current track',
      run: onCurrent((id) => {
        toggleSolo(services, id);
      }),
    },
    {
      id: 'track.clearMuteSolo',
      title: 'Unmute and unsolo all tracks',
      run: () => {
        clearMuteSolo(services);
      },
    },
    {
      id: 'track.showAll',
      title: 'Show all tracks',
      run: () => {
        showAllTracks(services);
      },
    },
    { id: 'track.notationTab', title: 'Show current track as tab', run: notation('tab') },
    {
      id: 'track.notationStandard',
      title: 'Show current track as standard notation',
      run: notation('standard'),
    },
    {
      id: 'track.notationBoth',
      title: 'Show current track as tab and standard notation',
      run: notation('both'),
    },
  ];
}
