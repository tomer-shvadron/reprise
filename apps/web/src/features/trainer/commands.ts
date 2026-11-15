import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

export type TrainerCommandId =
  'trainer.speedTrainer' | 'trainer.tuner' | 'trainer.metronome' | 'trainer.fretboard';

type TrainerCommand = Command & { id: TrainerCommandId };

export function trainerCommands(services: Pick<AppServices, 'ui'>): TrainerCommand[] {
  const { ui } = services;
  const show = (view: 'speedTrainer' | 'tuner' | 'metronome' | 'fretboard') => () => {
    ui.getState().showPanelView(view);
  };
  return [
    { id: 'trainer.speedTrainer', title: 'Show speed trainer', run: show('speedTrainer') },
    { id: 'trainer.tuner', title: 'Show tuner', run: show('tuner') },
    { id: 'trainer.metronome', title: 'Show metronome', run: show('metronome') },
    { id: 'trainer.fretboard', title: 'Show fretboard', run: show('fretboard') },
  ];
}
