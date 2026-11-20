import type { Notation } from '@reprise/model';

import type { Command } from '@/app/command-registry';
import type { Shortcut } from '@/app/keyboard';
import type { AppServices } from '@/app/services';

import { toggleSidebarFocus } from './sidebar-focus';
import {
  clearMuteSolo,
  goToTrackNumber,
  setTrackNotation,
  showAllTracks,
  stepTrack,
  toggleMultitrack,
  toggleMute,
  toggleSolo,
  type TrackServices,
} from './track-actions';

const GO_IDS = {
  1: 'track.go1',
  2: 'track.go2',
  3: 'track.go3',
  4: 'track.go4',
  5: 'track.go5',
  6: 'track.go6',
  7: 'track.go7',
  8: 'track.go8',
  9: 'track.go9',
} as const;
type TrackNumber = keyof typeof GO_IDS;

/**
 * The keys this folder adds, in one place so a change of key is one line here plus
 * `pnpm shortcuts:write`. Alt+digit rather than Cmd/Ctrl+digit, which are "Edit voice" while
 * editing; F7 has no other job in Reprise.
 */
const KEYS = {
  go: (number: TrackNumber): Shortcut => ({ key: String(number), alt: true }),
  focusSidebar: { key: 'F7' } satisfies Shortcut,
};

/** The command that jumps to a track, for the sidebar's tooltips; only tracks 1 to 9 have one. */
export function goCommandId(number: number): TrackCommandId | undefined {
  return number in GO_IDS ? GO_IDS[number as TrackNumber] : undefined;
}
const TRACK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const satisfies readonly TrackNumber[];

export type TrackCommandId =
  | 'track.previous'
  | 'track.next'
  | (typeof GO_IDS)[TrackNumber]
  | 'track.focusSidebar'
  | 'view.toggleMultitrack'
  | 'track.toggleMute'
  | 'track.toggleSolo'
  | 'track.clearMuteSolo'
  | 'track.showAll'
  | 'track.notationTab'
  | 'track.notationStandard'
  | 'track.notationBoth';

type TrackCommand = Command & { id: TrackCommandId };

export function trackCommands(services: TrackServices & Pick<AppServices, 'ui'>): TrackCommand[] {
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
    ...TRACK_NUMBERS.map((number): TrackCommand => ({
      id: GO_IDS[number],
      title: `Go to track ${String(number)}`,
      shortcut: KEYS.go(number),
      // The palette has `@` for tracks by name or number; nine more rows would only crowd it.
      inPalette: false,
      enabled: () => (document.getState().score?.tracks.length ?? 0) >= number,
      run: () => {
        goToTrackNumber(services, number);
      },
    })),
    {
      id: 'track.focusSidebar',
      title: 'Move focus between the tracks list and the score',
      shortcut: KEYS.focusSidebar,
      // The palette's dialog traps focus and returns it to where it was on close, so moving focus
      // from there cannot work.
      inPalette: false,
      enabled: () => document.getState().score !== undefined,
      run: () => {
        toggleSidebarFocus(services);
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
