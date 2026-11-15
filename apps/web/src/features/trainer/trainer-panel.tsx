import { Placeholder } from '@/components/placeholder';
import type { PanelView } from '@/state/ui';

import { MetronomePanel } from './metronome/metronome-panel';
import { SpeedTrainerPanel } from './speed-trainer/speed-trainer-panel';
import { TunerPanel } from './tuner/tuner-panel';

export type TrainerView = Exclude<PanelView, 'mixer'>;

const STUBS: Record<
  Exclude<TrainerView, 'speedTrainer' | 'tuner' | 'metronome'>,
  { title: string; workPackage: string }
> = {
  fretboard: { title: 'Fretboard', workPackage: 'WP-074' },
};

/**
 * Replaced one view at a time: the speed trainer (WP-070), the tuner (WP-071) and the metronome
 * (WP-072) are in, and WP-074 follows. Each lands as its own component here and replaces its
 * `STUBS` entry with a branch for that component.
 */
export function TrainerPanel({ view }: { view: TrainerView }) {
  if (view === 'speedTrainer') return <SpeedTrainerPanel />;
  if (view === 'tuner') return <TunerPanel />;
  if (view === 'metronome') return <MetronomePanel />;
  const { title, workPackage } = STUBS[view];
  return <Placeholder title={title} workPackage={workPackage} />;
}
