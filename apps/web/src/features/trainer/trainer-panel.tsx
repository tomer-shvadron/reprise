import { Placeholder } from '@/components/placeholder';
import type { PanelView } from '@/state/ui';

export type TrainerView = Exclude<PanelView, 'mixer'>;

const STUBS: Record<TrainerView, { title: string; workPackage: string }> = {
  speedTrainer: { title: 'Speed trainer', workPackage: 'WP-070' },
  tuner: { title: 'Tuner', workPackage: 'WP-071' },
  metronome: { title: 'Metronome', workPackage: 'WP-072' },
  fretboard: { title: 'Fretboard', workPackage: 'WP-074' },
};

/**
 * Replaced one view at a time by WP-070, WP-071, WP-072 and WP-074. Each lands as its own
 * component here and the switch below swaps its placeholder for it.
 */
export function TrainerPanel({ view }: { view: TrainerView }) {
  const { title, workPackage } = STUBS[view];
  return <Placeholder title={title} workPackage={workPackage} />;
}
