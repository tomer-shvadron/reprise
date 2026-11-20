import { XIcon } from 'lucide-react';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpeedTrainerChip } from '@/features/trainer';
import { PlaybackButtons, PracticeToggles, TempoControl } from '@/features/transport';

const divider = <Separator orientation="vertical" className="h-6! max-[900px]:hidden" />;

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
      {divider}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Leave practice mode"
            aria-keyshortcuts={leave.ariaKeys}
            data-command="view.leavePracticeMode"
            onMouseDown={keepFocus}
            onClick={leave.run}
          >
            <XIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText('Leave practice mode', leave.keys)}</TooltipContent>
      </Tooltip>
    </div>
  );
}
