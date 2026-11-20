import { AudioLinesIcon, GaugeIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { rampProgress } from './speed-trainer/ramp';
import { speedTrainerFor } from './speed-trainer/speed-trainer-for';

/** When the chip shows its text: `auto` hides it below 1100 px, leaving the icon. */
export type ChipText = 'auto' | 'always' | 'never';

const TEXT_CLASS: Record<ChipText, string> = {
  auto: 'hidden min-[1100px]:inline',
  always: 'inline',
  never: 'hidden',
};

/**
 * The speed trainer at a glance: off, or the step's tempo, a bar of progress to the target and the
 * pass count. A click shows its settings in the panel. It reads the trainer's store and takes no
 * layout from where it is placed, so the practice-mode capsule can reuse it.
 */
export function SpeedTrainerChip({
  text = 'auto',
  command = 'trainer.speedTrainer',
}: {
  text?: ChipText;
  /**
   * What a click runs: show the settings in the panel (the transport), or start, hold or resume
   * (the practice capsule, where no panel exists).
   */
  command?: 'trainer.speedTrainer' | 'trainer.speedTrainerToggle';
}) {
  const services = useAppServices();
  const { status, plan, stepIndex, reps, repsPerStep } = useStore(
    speedTrainerFor(services),
    useShallow((state) => ({
      status: state.status,
      plan: state.plan,
      stepIndex: state.stepIndex,
      reps: state.reps,
      repsPerStep: state.config.repsPerStep,
    })),
  );
  const show = useCommand(command);
  const percent = plan?.percents[stepIndex];
  const target = plan?.percents.at(-1) ?? 0;
  const live = status !== 'idle' && percent !== undefined;
  const done = status === 'done';
  const fraction = rampProgress(plan, stepIndex, status);
  const pass = String(Math.min(reps + 1, repsPerStep));
  const passes = `${pass}/${String(repsPerStep)}`;
  const rounded = (value: number) => String(Math.round(value));

  // The visible words come first in the name, so a voice command that says them matches.
  let visible = 'Trainer off';
  let detail = 'speed trainer';
  if (live) {
    visible = done
      ? 'Done'
      : `${rounded(percent)}% · ${passes}${status === 'held' ? ' · held' : ''}`;
    detail = done
      ? `speed trainer reached ${rounded(target)} percent`
      : `speed trainer ${status}, ${rounded(percent)} percent of ${rounded(target)}, pass ${pass} of ${String(repsPerStep)}`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${visible} (${detail})`}
          aria-keyshortcuts={show.ariaKeys}
          data-command={command}
          data-testid="speed-trainer-chip"
          data-status={status}
          onMouseDown={keepFocus}
          onClick={show.run}
          className={live ? 'text-foreground' : 'text-muted-foreground'}
        >
          <GaugeIcon className={status === 'running' ? 'text-primary' : undefined} />
          <span
            data-testid="speed-trainer-chip-text"
            className={`${TEXT_CLASS[text]} text-xs tabular-nums`}
          >
            {visible}
          </span>
          {live && (
            <span
              aria-hidden="true"
              className="bg-muted relative block h-1 w-8 overflow-hidden rounded-full"
            >
              <span
                data-testid="speed-trainer-chip-bar"
                className="bg-primary absolute inset-y-0 left-0 block rounded-full"
                style={{ width: `${String(Math.round(fraction * 100))}%` }}
              />
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText('Speed trainer', show.keys)}</TooltipContent>
    </Tooltip>
  );
}

/** Opens the tuner in the panel; it does not start listening, so no microphone prompt appears. */
export function TunerButton() {
  const show = useCommand('trainer.tuner');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Tuner"
          aria-keyshortcuts={show.ariaKeys}
          data-command="trainer.tuner"
          onMouseDown={keepFocus}
          onClick={show.run}
        >
          <AudioLinesIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText('Tuner', show.keys)}</TooltipContent>
    </Tooltip>
  );
}
