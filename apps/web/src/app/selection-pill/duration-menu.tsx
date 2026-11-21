import { useStore } from 'zustand';

import { DurationStepItems, rhythmLabel } from '@/features/editor';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { keepFocus } from '../command-control';
import { useMenuFocusReturn } from '../menu-focus-return';
import { useAppServices } from '../services-context';

/**
 * The current entry duration, opening the status bar's duration steps (`DURATION_STEPS`, shared,
 * so the two menus cannot drift). A press keeps focus on the score, as the status bar's does, and
 * the menu gives focus back the same way.
 */
export function DurationMenu({
  itemKey,
  enabled,
  tabStop,
}: {
  itemKey: string;
  enabled: boolean;
  tabStop: boolean;
}) {
  const { entry } = useAppServices();
  const rhythm = useStore(entry, (state) => state.rhythm);
  const focusReturn = useMenuFocusReturn();
  const text = rhythmLabel(rhythm);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="rounded-full"
              aria-label={`Duration, ${text}`}
              data-pill-item={itemKey}
              tabIndex={tabStop ? 0 : -1}
              disabled={!enabled}
              onMouseDown={keepFocus}
              onPointerDownCapture={focusReturn.remember}
              onKeyDownCapture={focusReturn.remember}
            >
              {text}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Duration</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-48"
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        <DropdownMenuLabel>Duration</DropdownMenuLabel>
        <DurationStepItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
