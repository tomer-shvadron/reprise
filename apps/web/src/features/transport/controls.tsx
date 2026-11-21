import type { ComponentProps, ReactNode } from 'react';

import { keepFocus } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';

import type { TransportCommandId } from './commands';

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
    <CommandTooltip command={command} label={tip ?? label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        data-command={command}
        onMouseDown={keepFocus}
        onClick={bound.run}
        {...props}
      >
        {children}
      </Button>
    </CommandTooltip>
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
    <CommandTooltip command={command} label={tip ?? label}>
      <Toggle
        size="sm"
        aria-label={label}
        data-command={command}
        pressed={pressed}
        onMouseDown={keepFocus}
        onPressedChange={bound.run}
        {...props}
      >
        {children}
      </Toggle>
    </CommandTooltip>
  );
}

export { keepFocus };
