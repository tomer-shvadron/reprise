import type { PanelView } from '@/state/ui';

import type { RegisteredCommandId } from '../use-command';

/** The right panel's tabs: three trainer tools share the Practice tab as sub-tabs. */
export type PanelTabId = 'mixer' | 'practice' | 'effects' | 'history' | 'chords';

export type PracticeView = Extract<PanelView, 'speedTrainer' | 'tuner' | 'metronome'>;

export const PRACTICE_VIEWS: readonly { view: PracticeView; label: string }[] = [
  { view: 'speedTrainer', label: 'Speed trainer' },
  { view: 'tuner', label: 'Tuner' },
  { view: 'metronome', label: 'Metronome' },
];

/**
 * The tab's label, the view it shows first and the command whose shortcut its tooltip names (a
 * tab whose command has none shows the label alone).
 */
export const PANEL_TABS: readonly {
  id: PanelTabId;
  label: string;
  view: PanelView;
  command: RegisteredCommandId;
}[] = [
  { id: 'mixer', label: 'Mixer', view: 'mixer', command: 'view.togglePanel' },
  { id: 'practice', label: 'Practice', view: 'speedTrainer', command: 'trainer.speedTrainer' },
  { id: 'effects', label: 'Effects', view: 'effects', command: 'editor.toggleEffectsPanel' },
  { id: 'history', label: 'History', view: 'history', command: 'editor.showHistory' },
  { id: 'chords', label: 'Chords', view: 'chords', command: 'trainer.chords' },
];

export function tabOfView(view: PanelView): PanelTabId {
  if (view === 'speedTrainer' || view === 'tuner' || view === 'metronome') return 'practice';
  return view;
}
