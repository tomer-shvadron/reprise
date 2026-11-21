import type { MenuContext, MenuContribution, MenuItemSpec } from '@/app/context-menu/types';

const hasSelectedBars = ({ services }: MenuContext) =>
  services.selection.getState().bars !== undefined;

const play = ['play'] as const;

/** The fretboard's own switches; the dock's tab carries them too, since the board is not focusable. */
const fretboardItems: readonly MenuItemSpec[] = [
  {
    command: 'trainer.fretboardLeftHanded',
    group: 'view',
    checked: ({ services }) => services.ui.getState().fretboardLeftHanded,
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
      { command: 'trainer.fretboard', group: 'view', label: 'Close fretboard' },
      fretboardItems[0] as MenuItemSpec,
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
    items: [{ command: 'trainer.showFretboard', group: 'practice', modes: play }],
  },
];
