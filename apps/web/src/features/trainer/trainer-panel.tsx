import type { BottomPanelView, PanelView } from '@/state/ui';

import { Fretboard } from './fretboard/fretboard';
import { MetronomePanel } from './metronome/metronome-panel';
import { SpeedTrainerPanel } from './speed-trainer/speed-trainer-panel';
import { TunerPanel } from './tuner/tuner-panel';

/** The right panel's trainer views and the bottom region's. */
export type TrainerView = Exclude<PanelView, 'mixer' | 'effects' | 'history'> | BottomPanelView;

/**
 * Every trainer view has its component now: the speed trainer (WP-070), the tuner (WP-071), the
 * metronome (WP-072) and the fretboard (WP-074). The switch is exhaustive over `TrainerView`.
 */
export function TrainerPanel({ view }: { view: TrainerView }) {
  switch (view) {
    case 'speedTrainer':
      return <SpeedTrainerPanel />;
    case 'tuner':
      return <TunerPanel />;
    case 'metronome':
      return <MetronomePanel />;
    case 'fretboard':
      return <Fretboard />;
  }
}
