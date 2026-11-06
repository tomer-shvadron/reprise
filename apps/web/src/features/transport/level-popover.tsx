import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TransportCommandId } from './commands';
import { keepFocus, tooltipText } from './controls';
import type { TransportPopover } from './transport-ui';
import { useCommand } from './use-command';

interface LevelPopoverProps {
  popover: TransportPopover;
  command: TransportCommandId;
  label: string;
  /** 0 to 1. */
  value: number;
  onChange: (value: number) => void;
  note?: string;
  children: ReactNode;
}

const percentText = (value: number) => `${String(Math.round(value))}%`;

/** A trigger button and a popover holding one 0–100% slider, opened by click or its command. */
export function LevelPopover({
  popover,
  command,
  label,
  value,
  onChange,
  note,
  children,
}: LevelPopoverProps) {
  const { transport } = useAppServices();
  const open = useStore(transport, (state) => state.popover === popover);
  const bound = useCommand(command);
  const percent = value * 100;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        transport.getState().setPopover(next ? popover : undefined);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-keyshortcuts={bound.ariaKeys}
              data-command={command}
              onMouseDown={keepFocus}
            >
              {children}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipText(label, bound.keys)}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-56">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground tabular-nums">{percentText(percent)}</span>
        </div>
        <Slider
          value={[percent]}
          min={0}
          max={100}
          step={1}
          thumbLabel={label}
          valueText={percentText}
          onValueChange={([next]) => {
            if (next !== undefined) onChange(next / 100);
          }}
        />
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
      </PopoverContent>
    </Popover>
  );
}
