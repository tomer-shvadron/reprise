import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { StatusSegment } from './segment';

/** The score's region, where focus goes before the segment that had it unmounts. */
const scoreRegion = () =>
  globalThis.document.querySelector<HTMLElement>('[role="region"][aria-roledescription="score"]') ??
  globalThis.document.querySelector<HTMLElement>('main');

/**
 * Shows that the standalone metronome is running, wherever the user is: the click outlives its
 * panel on purpose (Alt+B stops it from anywhere), so without this nothing outside the panel says
 * it is on. A press runs the same toggle command, which stops it. Absent while it is off.
 *
 * The press unmounts the button, so a keyboard press first moves focus to the score (as the
 * practice mode does for the chrome it hides) rather than dropping it on the body. A narrow
 * window shrinks it to its dot, so it never squeezes the sound segment's text.
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
      aria-label="Metronome on"
      data-metronome-status
      className="shrink-0"
      onClickCapture={(event) => {
        if (globalThis.document.activeElement === event.currentTarget) {
          scoreRegion()?.focus({ preventScroll: true });
        }
      }}
    >
      <span
        aria-hidden="true"
        className="bg-primary size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
      />
      <span className="@max-[80rem]:hidden">Metronome on</span>
    </StatusSegment>
  );
}
