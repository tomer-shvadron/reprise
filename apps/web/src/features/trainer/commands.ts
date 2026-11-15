import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { tunerFor } from './tuner/tuner-for';
import { speedTrainerFor } from './speed-trainer/speed-trainer-for';
import type { SpeedTrainerServices } from './speed-trainer/speed-trainer-store';

export type TrainerCommandId =
  | 'trainer.speedTrainer'
  | 'trainer.speedTrainerToggle'
  | 'trainer.speedTrainerMissed'
  | 'trainer.speedTrainerReset'
  | 'trainer.tuner'
  | 'trainer.tunerToggle'
  | 'trainer.metronome'
  | 'trainer.fretboard';

type TrainerCommand = Command & { id: TrainerCommandId };

export function trainerCommands(
  services: Pick<AppServices, 'ui' | 'platform' | 'document' | 'selection'> & SpeedTrainerServices,
): TrainerCommand[] {
  const { ui } = services;
  const speedTrainer = () => speedTrainerFor(services).getState();
  const show = (view: 'speedTrainer' | 'tuner' | 'metronome' | 'fretboard') => () => {
    ui.getState().showPanelView(view);
  };
  return [
    { id: 'trainer.speedTrainer', title: 'Show speed trainer', run: show('speedTrainer') },
    {
      id: 'trainer.speedTrainerToggle',
      title: 'Start, hold or resume speed trainer',
      shortcut: { key: 's', alt: true },
      repeat: false,
      run: () => {
        ui.getState().showPanelView('speedTrainer');
        speedTrainer().toggle();
      },
    },
    {
      id: 'trainer.speedTrainerMissed',
      title: 'Mark speed trainer pass missed',
      shortcut: { key: 'x', alt: true },
      repeat: false,
      run: () => {
        speedTrainer().markMissed();
      },
    },
    {
      id: 'trainer.speedTrainerReset',
      title: 'Reset speed trainer',
      shortcut: { key: 's', alt: true, shift: true },
      repeat: false,
      run: () => {
        speedTrainer().reset();
      },
    },
    { id: 'trainer.tuner', title: 'Show tuner', run: show('tuner') },
    {
      id: 'trainer.tunerToggle',
      title: 'Start or stop tuner',
      repeat: false,
      run: () => {
        ui.getState().showPanelView('tuner');
        tunerFor(services).getState().toggle();
      },
    },
    { id: 'trainer.metronome', title: 'Show metronome', run: show('metronome') },
    { id: 'trainer.fretboard', title: 'Show fretboard', run: show('fretboard') },
  ];
}
