import type { MenuContext, MenuContribution } from '@/app/context-menu/types';

import { isFixed } from './tempo';

const hasScore = ({ services }: MenuContext) => services.document.getState().score !== undefined;

/** Play mode only here: the edit-mode score menus are another set. */
const play = ['play'] as const;

const hasSelectedBars = ({ services }: MenuContext) =>
  services.selection.getState().bars !== undefined;

/** The transport bar's own controls: the loop, the tempo, the count-in and the metronome. */
const barMenus: readonly MenuContribution[] = [
  {
    surface: 'transport.loop',
    items: [
      {
        command: 'transport.toggleLoop',
        group: 'play',
        label: 'Loop',
        when: hasScore,
        checked: ({ services }) => services.playback.getState().settings.loop !== undefined,
      },
      {
        command: 'transport.loopSelection',
        group: 'practice',
        label: 'Loop selected bars',
        when: hasSelectedBars,
      },
    ],
  },
  {
    surface: 'transport.tempo',
    items: [
      { command: 'transport.setTempo', group: 'play', when: hasScore },
      { command: 'transport.slowDown', group: 'play', when: hasScore },
      { command: 'transport.speedUp', group: 'play', when: hasScore },
      { command: 'transport.toggleSpeed', group: 'play', when: hasScore },
      {
        command: 'transport.toggleFixedTempo',
        group: 'play',
        when: hasScore,
        checked: ({ services }) => isFixed(services.playback.getState().settings.tempo),
      },
    ],
  },
  {
    surface: 'transport.countIn',
    items: [
      {
        command: 'transport.toggleCountIn',
        group: 'play',
        label: 'Count-in',
        checked: ({ services }) => services.playback.getState().settings.countIn,
      },
    ],
  },
  {
    surface: 'transport.metronome',
    items: [
      {
        command: 'transport.toggleMetronome',
        group: 'play',
        label: 'Metronome',
        checked: ({ services }) => services.playback.getState().settings.metronome.on,
      },
      { command: 'transport.metronomeVolume', group: 'play' },
    ],
  },
];

/** The transport's items on the score's menus; the surfaces nest, so a note's menu gets these too. */
export const transportMenus: readonly MenuContribution[] = [
  ...barMenus,
  {
    surface: 'score.beat',
    items: [
      {
        command: 'transport.playFromSelection',
        group: 'play',
        modes: play,
        label: 'Play from here',
      },
    ],
  },
  {
    surface: 'score.bar',
    items: [
      {
        command: 'transport.playFromSelection',
        group: 'play',
        modes: play,
        label: 'Play from this bar',
      },
      {
        command: 'transport.loopSelection',
        group: 'practice',
        modes: play,
        label: 'Loop this bar',
      },
    ],
  },
  {
    surface: 'score.range',
    items: [
      {
        command: 'transport.playFromSelection',
        group: 'play',
        modes: play,
        label: 'Play from here',
      },
      {
        command: 'transport.loopSelection',
        group: 'practice',
        modes: play,
        label: 'Loop these bars',
      },
    ],
  },
  {
    surface: 'score.section',
    items: [
      {
        command: 'transport.playFromSelection',
        group: 'play',
        modes: play,
        label: 'Play from this section',
      },
      { command: 'transport.loopSection', group: 'practice', modes: play },
    ],
  },
  {
    surface: 'score.chord',
    items: [
      {
        command: 'transport.playFromSelection',
        group: 'play',
        modes: play,
        label: 'Play from here',
      },
    ],
  },
  {
    surface: 'score.paper',
    items: [
      { command: 'transport.playFromStart', group: 'play', modes: play, when: hasScore },
      {
        command: 'transport.toggleLoop',
        group: 'practice',
        modes: play,
        when: hasScore,
        label: 'Loop',
        checked: ({ services }) => services.playback.getState().settings.loop !== undefined,
      },
    ],
  },
];
