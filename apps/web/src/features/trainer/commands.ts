import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { selectRunning } from '@/state/playback';

import { applyLoop, seekToBar, targetBars, targetPlace } from '@/features/transport';

import type { SpeedTrainerServices } from './speed-trainer/speed-trainer-store';
import { tunerFor } from './tuner/tuner-for';
import { speedTrainerFor } from './speed-trainer/speed-trainer-for';

export type TrainerCommandId =
  | 'trainer.speedTrainer'
  | 'trainer.speedTrainerToggle'
  | 'trainer.speedTrainerMissed'
  | 'trainer.speedTrainerReset'
  | 'trainer.tuner'
  | 'trainer.tunerToggle'
  | 'trainer.metronome'
  | 'trainer.metronomeToggle'
  | 'trainer.fretboard'
  | 'trainer.speedTrainerOnSelection'
  | 'trainer.showFretboard';

type TrainerCommand = Command & { id: TrainerCommandId };

export function trainerCommands(
  services: Pick<
    AppServices,
    'ui' | 'platform' | 'document' | 'selection' | 'menuTarget' | 'heard'
  > &
    SpeedTrainerServices,
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
    {
      id: 'trainer.speedTrainerOnSelection',
      title: 'Speed trainer on selection',
      repeat: false,
      enabled: () => targetBars(services) !== undefined,
      run: () => {
        const { score } = services.document.getState();
        const bars = targetBars(services);
        if (!score || !bars) return;
        // The loop first, as the trainer binds to the loop it finds at Start; a loop the engine
        // refuses stays as it was, and the trainer is not started on bars it cannot play.
        const failed = applyLoop(services, score, bars);
        if (failed) {
          services.transport.getState().announce(failed);
          return;
        }
        ui.getState().showPanelView('speedTrainer');
        const trainer = speedTrainer();
        // Idle: start. Running or held, the run belongs to the loop it began on, so it starts over.
        if (trainer.status !== 'idle') trainer.reset();
        trainer.start();
      },
    },
    {
      id: 'trainer.showFretboard',
      title: 'Show fretboard',
      repeat: false,
      run: () => {
        // Never a toggle: a menu item that hides what it was asked to show would surprise.
        ui.getState().showBottomPanelView('fretboard');
        // The fretboard follows the playhead, so a stopped one is moved to the beat to show it.
        const { score } = services.document.getState();
        const target = services.menuTarget.getState().target;
        const beat = target?.kind === 'note' || target?.kind === 'beat' || target?.kind === 'chord';
        const place = beat ? targetPlace(services) : undefined;
        // The fretboard draws the current track, which a loop on keeps the right-click from adopting.
        if (target && 'track' in target && target.track !== undefined) {
          services.selection.getState().setCurrentTrack(target.track);
        }
        // `keepLoop`: showing a beat is not worth ending the loop the player is practising.
        if (score && place && !selectRunning(services.playback.getState())) {
          seekToBar(services, score, place, true);
        }
      },
    },
  ];
}
