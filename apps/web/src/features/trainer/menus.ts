import { arpeggioOverlayFor } from './fretboard/arpeggio-overlay';
import type { MenuContext, MenuContribution, MenuItemSpec } from '@/app/context-menu/types';

const hasSelectedBars = ({ services }: MenuContext) =>
  services.selection.getState().bars !== undefined;

const play = ['play'] as const;

const leftHandedItem: MenuItemSpec = {
  command: 'trainer.fretboardLeftHanded',
  group: 'view',
  checked: ({ services }) => services.ui.getState().fretboardLeftHanded,
};

const fretboardShown = ({ services }: MenuContext) => {
  // The fretboard is the dock's only view.
  return services.ui.getState().bottomPanel.open;
};

/** The fretboard's own switches; the dock's tab carries them too, since the board is not focusable. */
const fretboardItems: readonly MenuItemSpec[] = [
  leftHandedItem,
  { command: 'trainer.fretboardSongScale', group: 'view' },
  { command: 'trainer.fretboardClearScale', group: 'view' },
  {
    command: 'trainer.fretboardArpeggio',
    group: 'view',
    checked: ({ services }) => arpeggioOverlayFor(services).getState().on,
  },
  { command: 'trainer.fretboard', group: 'view', label: 'Hide fretboard' },
];

/** The practice items of the score's menus: the speed trainer on bars and the fretboard on a beat. */
export const trainerMenus: readonly MenuContribution[] = [
  {
    surface: 'transport.loop',
    items: [
      { command: 'trainer.speedTrainerOnSelection', group: 'practice', when: hasSelectedBars },
      { command: 'trainer.speedTrainer', group: 'practice' },
    ],
  },
  {
    surface: 'transport.tempo',
    items: [{ command: 'trainer.speedTrainer', group: 'practice' }],
  },
  {
    surface: 'transport.metronome',
    items: [
      { command: 'trainer.metronome', group: 'view' },
      { command: 'trainer.metronomeToggle', group: 'practice' },
    ],
  },
  { surface: 'fretboard', items: fretboardItems },
  {
    surface: 'dock.tab',
    items: [
      // The strip shows collapsed too, where the toggle would open the board: that case says "Show".
      {
        command: 'trainer.fretboard',
        group: 'view',
        label: 'Close fretboard',
        when: fretboardShown,
      },
      {
        command: 'trainer.showFretboard',
        group: 'view',
        when: (at) => !fretboardShown(at),
      },
      leftHandedItem,
    ],
  },
  {
    surface: 'score.beat',
    items: [
      {
        command: 'trainer.showFretboard',
        group: 'practice',
        modes: play,
        label: 'Show on fretboard',
      },
    ],
  },
  {
    surface: 'score.bar',
    items: [
      {
        command: 'trainer.speedTrainerOnSelection',
        group: 'practice',
        modes: play,
        label: 'Speed trainer on this bar',
      },
    ],
  },
  {
    surface: 'score.range',
    items: [
      {
        command: 'trainer.speedTrainerOnSelection',
        group: 'practice',
        modes: play,
        label: 'Speed trainer on these bars',
      },
      { command: 'trainer.showFretboard', group: 'practice', modes: play },
    ],
  },
  {
    surface: 'score.chord',
    items: [
      { command: 'trainer.showFretboard', group: 'practice', modes: play },
      { command: 'trainer.chordShapesFor', group: 'practice' },
    ],
  },
  {
    surface: 'score.section',
    items: [{ command: 'trainer.sectionInsights', group: 'practice' }],
  },
];
