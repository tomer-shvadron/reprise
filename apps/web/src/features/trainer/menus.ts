import type { MenuContribution } from '@/app/context-menu/types';

const play = ['play'] as const;

/** The practice items of the score's menus: the speed trainer on bars and the fretboard on a beat. */
export const trainerMenus: readonly MenuContribution[] = [
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
