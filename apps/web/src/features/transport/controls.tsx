import type { ComponentProps, MouseEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TransportCommandId } from './commands';
import { useCommand } from './use-command';

// A click must not take focus from the page, or the next Space would press the button again.
const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};

function tooltipText(label: string, keys: string | undefined): string {
  return keys ? `${label} (${keys})` : label;
}

interface TransportButtonProps extends Omit<ComponentProps<typeof Button>, 'onClick'> {
  command: TransportCommandId;
  label: string;
  /** Tooltip text before the shortcut; the label by default. */
  tip?: string;
  children: ReactNode;
}

export function TransportButton({ command, label, tip, children, ...props }: TransportButtonProps) {
  const bound = useCommand(command);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-keyshortcuts={bound.ariaKeys}
          data-command={command}
          onMouseDown={keepFocus}
          onClick={bound.run}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText(tip ?? label, bound.keys)}</TooltipContent>
    </Tooltip>
  );
}

interface TransportToggleProps extends Omit<
  ComponentProps<typeof Toggle>,
  'onPressedChange' | 'pressed'
> {
  command: TransportCommandId;
  label: string;
  tip?: string;
  pressed: boolean;
  children: ReactNode;
}

export function TransportToggle({
  command,
  label,
  tip,
  pressed,
  children,
  ...props
}: TransportToggleProps) {
  const bound = useCommand(command);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          aria-label={label}
          aria-keyshortcuts={bound.ariaKeys}
          data-command={command}
          pressed={pressed}
          onMouseDown={keepFocus}
          onPressedChange={bound.run}
          {...props}
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{tooltipText(tip ?? label, bound.keys)}</TooltipContent>
    </Tooltip>
  );
}

export { keepFocus, tooltipText };
