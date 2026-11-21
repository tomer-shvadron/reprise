import { lazy, Suspense } from 'react';

import type { BottomPanelView, PanelView } from '@/state/ui';

import { Fretboard } from './fretboard/fretboard';
import { MetronomePanel } from './metronome/metronome-panel';
import { SpeedTrainerPanel } from './speed-trainer/speed-trainer-panel';
import { TunerPanel } from './tuner/tuner-panel';

// Lazy because the panel paints with the score feature, which the test setup's import of the
// library would otherwise load before a score test can mock its fonts and primitives.
const ChordsPanel = lazy(() =>
  import('./chords/chords-panel').then((module) => ({ default: module.ChordsPanel })),
);

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
    case 'chords':
      return (
        <Suspense fallback={null}>
          <ChordsPanel />
        </Suspense>
      );
    case 'fretboard':
      return <Fretboard />;
  }
}
