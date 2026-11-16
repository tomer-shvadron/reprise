import { Placeholder } from '@/components/placeholder';
import type { BottomPanelView, PanelView } from '@/state/ui';

import { Fretboard } from './fretboard/fretboard';
import { MetronomePanel } from './metronome/metronome-panel';
import { SpeedTrainerPanel } from './speed-trainer/speed-trainer-panel';

/** The right panel's trainer views and the bottom region's. */
export type TrainerView = Exclude<PanelView, 'mixer'> | BottomPanelView;

const STUBS: Record<
  Exclude<TrainerView, 'speedTrainer' | 'metronome' | 'fretboard'>,
  { title: string; workPackage: string }
> = {
  tuner: { title: 'Tuner', workPackage: 'WP-071' },
  // The effects palette is not a trainer tool; it parks here until WP-082 PR B gives it a home.
  effects: { title: 'Effects', workPackage: 'WP-082' },
  // Likewise for the history panel: WP-084 PR 2 replaces this entry.
  history: { title: 'History', workPackage: 'WP-084' },
};

/**
 * Replaced one view at a time: the speed trainer (WP-070), the metronome and the fretboard
 * (WP-074) are in, and WP-071 follows. Each lands as its own component here and replaces its
 * `STUBS` entry with a branch for that component.
 */
export function TrainerPanel({ view }: { view: TrainerView }) {
  if (view === 'speedTrainer') return <SpeedTrainerPanel />;
  if (view === 'metronome') return <MetronomePanel />;
  if (view === 'fretboard') return <Fretboard />;
  const { title, workPackage } = STUBS[view];
  return <Placeholder title={title} workPackage={workPackage} />;
}
