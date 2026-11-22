import { XIcon } from 'lucide-react';
import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { scoreRegion } from '@/app/score-region';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SpeedTrainerChip } from '@/features/trainer';
import { PlaybackButtons, PracticeToggles, TempoControl } from '@/features/transport';

const divider = <Separator orientation="vertical" className="h-6! max-[900px]:hidden" />;

/**
 * Shows that the standalone metronome click is running (the status bar that shows it is hidden in
 * this mode) and stops it. Not the capsule's Metronome toggle, which is the song's own click.
 * The dot is paired
 * with the word "Click" (hidden below 900px, like the dividers) so it does not read as the state of
 * the Metronome toggle beside it. Absent while it is off; the press unmounts it, so a keyboard
 * press first moves focus to the score.
 */
function StandaloneClickIndicator() {
  const { playback } = useAppServices();
  const running = useStore(playback, (state) => state.click.running);
  const toggle = useCommand('trainer.metronomeToggle');
  if (!running) return null;
  return (
    <>
      {divider}
      <CommandTooltip command="trainer.metronomeToggle" label="Stop the standalone metronome">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Click, standalone metronome on"
          data-command="trainer.metronomeToggle"
          data-click-indicator
          className="shrink-0"
          onMouseDown={keepFocus}
          onClickCapture={(event) => {
            if (globalThis.document.activeElement === event.currentTarget) {
              scoreRegion()?.focus({ preventScroll: true });
            }
          }}
          onClick={toggle.run}
        >
          <span
            aria-hidden="true"
            className="bg-primary size-2 rounded-full motion-safe:animate-pulse"
          />
          <span className="max-[900px]:hidden">Click</span>
        </Button>
      </CommandTooltip>
    </>
  );
}

/**
 * The practice controls in one floating pill at the bottom of the score: the transport's own
 * buttons, tempo and toggles, the speed trainer chip (which starts it here, as no panel exists) and
 * the way out. Not a toolbar: the sliders need the arrows. Light shows a shadow, dark an outline,
 * as the mode switch does.
 */
export function PracticeCapsule() {
  const leave = useCommand('view.leavePracticeMode');
  return (
    <div
      role="region"
      aria-label="Practice controls"
      className="bg-popover text-popover-foreground dark:border-border absolute bottom-3 left-1/2 z-10 flex h-12 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-full border border-transparent px-3 shadow-lg dark:shadow-none"
    >
      <PlaybackButtons />
      {divider}
      <TempoControl />
      {divider}
      <PracticeToggles speedTrainer={<SpeedTrainerChip command="trainer.speedTrainerToggle" />} />
      <StandaloneClickIndicator />
      {divider}
      <CommandTooltip command="view.leavePracticeMode" label="Leave practice mode">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Leave practice mode"
          data-command="view.leavePracticeMode"
          onMouseDown={keepFocus}
          onClick={leave.run}
        >
          <XIcon />
        </Button>
      </CommandTooltip>
    </div>
  );
}
