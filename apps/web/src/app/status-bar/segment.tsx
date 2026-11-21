import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useMenuFocusReturn } from '@/app/menu-focus-return';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StatusSegmentName } from '@/state/menu-target';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// `text-2xs!` because the button's size variant sets `text-xs`; a hover or open segment turns
// `text-foreground`, since muted text on the hover fill is under 4.5:1 in the light theme.
const SEGMENT = 'h-5 gap-1 rounded px-1.5 text-2xs! font-normal whitespace-nowrap tabular-nums';

type SegmentProps = Omit<ComponentProps<'button'>, 'onClick' | 'children'> & {
  /** What opens or toggles, for the tooltip; the visible text is the accessible name. */
  label: string;
  children: ReactNode;
  /** Which segment this is, for its context menu. */
  segment: StatusSegmentName;
  /** The context menu's accessible name. */
  menuLabel: string;
};

/** A status bar value that runs a registered command: a real button, and a click keeps focus on the page. */
export function StatusSegment({
  command,
  label,
  segment,
  menuLabel,
  className,
  children,
  ...rest
}: SegmentProps & { command: RegisteredCommandId }) {
  const bound = useCommand(command);
  const menu = useStaticContextMenu({
    surface: 'status.segment',
    target: { kind: 'status', segment },
    label: menuLabel,
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(SEGMENT, className)}
          aria-keyshortcuts={bound.ariaKeys}
          onMouseDown={keepFocus}
          onClick={bound.run}
          {...menu}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText(label, bound.keys)}</TooltipContent>
    </Tooltip>
  );
}

/** A status bar value that opens a menu above it, and gives focus back as the View menu does. */
export function StatusMenu({
  label,
  segment,
  menuLabel,
  align = 'end',
  className,
  contentClassName,
  menu,
  describedBy,
  children,
  ...rest
}: SegmentProps & {
  align?: 'start' | 'end';
  /** The menu's items. */
  menu: ReactNode;
  contentClassName?: string;
  /** An element in the menu that explains a disabled item. */
  describedBy?: string | undefined;
}) {
  const focusReturn = useMenuFocusReturn();
  const contextMenu = useStaticContextMenu({
    surface: 'status.segment',
    target: { kind: 'status', segment },
    label: menuLabel,
  });
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className={cn(SEGMENT, className)}
              onMouseDown={keepFocus}
              onPointerDownCapture={focusReturn.remember}
              onKeyDownCapture={focusReturn.remember}
              {...contextMenu}
              {...rest}
            >
              {children}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align={align}
        className={cn('w-48', contentClassName)}
        aria-describedby={describedBy}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        {menu}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
