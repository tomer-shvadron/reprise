import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { StatusSegment } from './segment';

/**
 * Shows that the standalone metronome is running, wherever the user is: the click outlives its
 * panel on purpose (Alt+B stops it from anywhere), so without this nothing outside the panel says
 * it is on. A press runs the same toggle command, which stops it. Absent while it is off.
 */
export function MetronomeSegment() {
  const { playback } = useAppServices();
  const running = useStore(playback, (state) => state.click.running);
  if (!running) return null;
  return (
    <StatusSegment
      command="trainer.metronomeToggle"
      label="Stop the metronome"
      segment="metronome"
      menuLabel="Metronome"
      data-metronome-status
    >
      <span
        aria-hidden="true"
        className="bg-primary size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
      />
      Metronome on
    </StatusSegment>
  );
}
