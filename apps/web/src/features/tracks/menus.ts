import type { Notation } from '@reprise/model';

import { onStatus } from '@/app/context-menu/shell-menus';
import type { MenuContext, MenuContribution, MenuItemSpec } from '@/app/context-menu/types';

import { trackOfTarget } from './menu-target';
import { effectiveMix, effectiveNotation, notationChoices } from './track-model';

const mixOf = ({ services, target }: MenuContext) => {
  const track = trackOfTarget(services, target);
  return track && effectiveMix(track, services.playback.getState().mixer[track.id]);
};

const notation = (choice: Notation) => ({
  when: ({ services, target }: MenuContext) => {
    const track = trackOfTarget(services, target);
    return track !== undefined && notationChoices(track).includes(choice);
  },
  checked: ({ services, target }: MenuContext) => {
    const track = trackOfTarget(services, target);
    return (
      track !== undefined &&
      effectiveNotation(track, services.document.getState().view.notation) === choice
    );
  },
});

/** What a track's row in the sidebar and its strip in the mixer share. */
const muteSoloItems: readonly MenuItemSpec[] = [
  {
    command: 'track.toggleMute',
    group: 'play',
    label: 'Mute',
    checked: (at) => mixOf(at)?.mute === true,
  },
  {
    command: 'track.toggleSolo',
    group: 'play',
    label: 'Solo',
    checked: (at) => mixOf(at)?.solo === true,
  },
  { command: 'track.clearMuteSolo', group: 'play' },
];

const propertiesItem: MenuItemSpec = { command: 'track.properties', group: 'properties' };
const trackItems: readonly MenuItemSpec[] = [...muteSoloItems, propertiesItem];

const notationItems: readonly MenuItemSpec[] = [
  { command: 'track.notationTab', group: 'view', label: 'Show as tab', ...notation('tab') },
  {
    command: 'track.notationStandard',
    group: 'view',
    label: 'Show as standard notation',
    ...notation('standard'),
  },
  {
    command: 'track.notationBoth',
    group: 'view',
    label: 'Show as tab and standard notation',
    ...notation('both'),
  },
];

const rowItems: readonly MenuItemSpec[] = [
  ...muteSoloItems,
  ...notationItems,
  { command: 'view.toggleMultitrack', group: 'view' },
  { command: 'track.showAll', group: 'view' },
  propertiesItem,
];

/** The track list, the mixer's strips and its master strip. Edit mode adds the track management in `editor/menus.ts`. */
export const trackMenus: readonly MenuContribution[] = [
  { surface: 'track.row', items: rowItems },
  {
    surface: 'status.segment',
    items: [
      ...notationItems.map((item) => ({
        ...item,
        when: (at: MenuContext) => onStatus('notation')(at) && (item.when?.(at) ?? true),
      })),
    ],
  },
  { surface: 'mixer.strip', items: trackItems },
  {
    surface: 'mixer.master',
    items: [
      { command: 'transport.masterVolume', group: 'play' },
      {
        command: 'transport.toggleMetronome',
        group: 'play',
        checked: ({ services }) => services.playback.getState().settings.metronome.on,
      },
      { command: 'transport.metronomeVolume', group: 'play' },
      { command: 'track.clearMuteSolo', group: 'play' },
    ],
  },
];
