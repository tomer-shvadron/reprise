import { Placeholder } from '@/components/placeholder';
import type { PanelView } from '@/state/ui';

import { SpeedTrainerPanel } from './speed-trainer/speed-trainer-panel';
import { TunerPanel } from './tuner/tuner-panel';

export type TrainerView = Exclude<PanelView, 'mixer'>;

const STUBS: Record<
  Exclude<TrainerView, 'speedTrainer' | 'tuner'>,
  { title: string; workPackage: string }
> = {
  metronome: { title: 'Metronome', workPackage: 'WP-072' },
  fretboard: { title: 'Fretboard', workPackage: 'WP-074' },
};

/**
 * Replaced one view at a time: the speed trainer (WP-070) and the tuner (WP-071) are in, and
 * WP-072 and WP-074 follow. Each lands as its own component here and replaces its `STUBS`
 * entry with a branch for that component.
 */
export function TrainerPanel({ view }: { view: TrainerView }) {
  if (view === 'speedTrainer') return <SpeedTrainerPanel />;
  if (view === 'tuner') return <TunerPanel />;
  const { title, workPackage } = STUBS[view];
  return <Placeholder title={title} workPackage={workPackage} />;
}
