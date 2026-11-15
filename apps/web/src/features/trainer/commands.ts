import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { speedTrainerFor } from './speed-trainer/speed-trainer-for';
import type { SpeedTrainerServices } from './speed-trainer/speed-trainer-store';

export type TrainerCommandId =
  | 'trainer.speedTrainer'
  | 'trainer.speedTrainerToggle'
  | 'trainer.speedTrainerMissed'
  | 'trainer.speedTrainerReset'
  | 'trainer.tuner'
  | 'trainer.metronome'
  | 'trainer.metronomeToggle'
  | 'trainer.fretboard';

type TrainerCommand = Command & { id: TrainerCommandId };

export function trainerCommands(
  services: Pick<AppServices, 'ui'> & SpeedTrainerServices,
): TrainerCommand[] {
  const { ui } = services;
  const speedTrainer = () => speedTrainerFor(services).getState();
  const show = (view: 'speedTrainer' | 'tuner' | 'metronome') => () => {
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
    { id: 'trainer.metronome', title: 'Show metronome', run: show('metronome') },
    {
      id: 'trainer.metronomeToggle',
      title: 'Start or stop standalone metronome',
      shortcut: { key: 'b', alt: true },
      repeat: false,
      run: () => {
        ui.getState().showPanelView('metronome');
        if (services.playback.getState().click.running) services.audio.stopClick();
        else services.audio.startClick();
      },
    },
    {
      id: 'trainer.fretboard',
      title: 'Toggle fretboard',
      // The fretboard docks in the bottom region, and a second run closes it again.
      run: () => {
        ui.getState().toggleBottomPanelView('fretboard');
      },
    },
  ];
}
