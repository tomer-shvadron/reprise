import { AudioLinesIcon, GaugeIcon } from 'lucide-react';
import { useStore } from 'zustand';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { speedTrainerFor } from './speed-trainer/speed-trainer-for';

/** When the chip shows its text: `auto` hides it below 1100 px, leaving the icon. */
export type ChipText = 'auto' | 'always' | 'never';

const TEXT_CLASS: Record<ChipText, string> = {
  auto: 'hidden min-[1100px]:inline',
  always: 'inline',
  never: 'hidden',
};

const STATUS_WORD = { idle: 'off', running: 'running', held: 'held', done: 'done' } as const;

/**
 * The speed trainer at a glance: off, or the step's tempo, a bar of progress to the target and the
 * pass count. A click shows its settings in the panel. It reads the trainer's store and takes no
 * layout from where it is placed, so the practice-mode capsule can reuse it.
 */
export function SpeedTrainerChip({ text = 'auto' }: { text?: ChipText }) {
  const services = useAppServices();
  const { status, plan, stepIndex, reps, config } = useStore(speedTrainerFor(services));
  const show = useCommand('trainer.speedTrainer');
  const percents = plan?.percents ?? [];
  const percent = percents[stepIndex];
  const first = percents[0] ?? 0;
  const target = percents.at(-1) ?? 0;
  const live = status !== 'idle' && percent !== undefined;
  const fraction =
    status === 'done' ? 1 : live && target > first ? (percent - first) / (target - first) : 0;
  const pass = Math.min(reps + 1, config.repsPerStep);
  const passes = `${String(pass)}/${String(config.repsPerStep)}`;
  const word = STATUS_WORD[status];

  const summary = live
    ? status === 'done'
      ? `Done at ${String(Math.round(target))} percent`
      : `${String(Math.round(percent))} percent of ${String(Math.round(target))}, pass ${String(pass)} of ${String(config.repsPerStep)}`
    : '';
  const label = `Speed trainer: ${word}${summary ? `, ${summary}` : ''}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-keyshortcuts={show.ariaKeys}
          data-command="trainer.speedTrainer"
          data-testid="speed-trainer-chip"
          data-status={status}
          onMouseDown={keepFocus}
          onClick={show.run}
          className={live ? 'text-foreground' : 'text-muted-foreground'}
        >
          <GaugeIcon className={status === 'running' ? 'text-primary' : undefined} />
          <span className={`${TEXT_CLASS[text]} text-xs tabular-nums`}>
            {live ? (
              <>
                {status === 'done' ? 'Done' : `${String(Math.round(percent))}%`}
                {status !== 'done' && ` · ${passes}`}
                {status === 'held' && ' · held'}
              </>
            ) : (
              'Trainer off'
            )}
          </span>
          {live && (
            <span
              aria-hidden="true"
              className="bg-muted relative block h-1 w-8 overflow-hidden rounded-full"
            >
              <span
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
