import type { Notation } from '@reprise/model';
import { ChevronDownIcon, EyeIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { useStore } from 'zustand';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  effectiveNotation,
  NO_TAB_REASON,
  NOTATION_NAMES,
  notationChoices,
} from '@/features/tracks';
import { ZOOM } from '@/state/ui';

const NOTATION_COMMANDS: Record<Notation, RegisteredCommandId> = {
  tab: 'track.notationTab',
  standard: 'track.notationStandard',
  both: 'track.notationBoth',
};
const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];

function NotationItem({
  notation,
  disabled,
  active,
}: {
  notation: Notation;
  disabled: boolean;
  active: boolean;
}) {
  const command = useCommand(NOTATION_COMMANDS[notation]);
  return (
    <DropdownMenuRadioItem
      value={notation}
      disabled={disabled}
      onSelect={() => {
        if (!active) command.run();
      }}
    >
      {NOTATION_NAMES[notation]}
    </DropdownMenuRadioItem>
  );
}

function ZoomItem({
  command,
  label,
  disabled,
}: {
  command: RegisteredCommandId;
  label: string;
  disabled?: boolean;
}) {
  const bound = useCommand(command);
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(event) => {
        // Zoom steps repeat, so the menu stays open.
        event.preventDefault();
        bound.run();
      }}
    >
      {label}
      {bound.keys && <DropdownMenuShortcut>{bound.keys}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

/** Layout, zoom and the current track's notation, each running its registered command. */
export function ViewMenu() {
  const { ui, document, selection } = useAppServices();
  const mode = useStore(ui, (state) => state.view.mode);
  const zoom = useStore(ui, (state) => state.zoom);
  const score = useStore(document, (state) => state.score);
  const notationByTrack = useStore(document, (state) => state.view.notation);
  const currentId = useStore(selection, (state) => state.currentTrack);
  const toggleView = useCommand('view.toggleViewMode');
  const track = score?.tracks.find((candidate) => candidate.id === currentId);
  const choices = track ? notationChoices(track) : [];
  const notation = track ? effectiveNotation(track, notationByTrack) : undefined;
  const limited = track !== undefined && choices.length > 0 && choices.length < NOTATIONS.length;
  const reasonId = useId();
  // Where focus was when the menu opened: Radix would return it to the trigger, which then takes
  // the next Space, so only someone who tabbed to the trigger goes back to it.
  const returnTo = useRef<Element | null>(null);

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        if (next) returnTo.current = globalThis.document.activeElement;
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" aria-label="View options" onMouseDown={keepFocus}>
              <EyeIcon aria-hidden="true" />
              <span className="hidden whitespace-nowrap md:inline">View</span>
              <ChevronDownIcon aria-hidden="true" className="hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipText('View options', undefined)}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-60"
        aria-describedby={limited ? reasonId : undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnTo.current;
          returnTo.current = null;
          if (
            target instanceof HTMLElement &&
            target.isConnected &&
            target !== globalThis.document.body
          ) {
            target.focus();
          }
        }}
      >
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(next) => {
            if (next !== mode) toggleView.run();
          }}
        >
          <DropdownMenuRadioItem value="paged">
            Page view
            {toggleView.keys && (
              <DropdownMenuShortcut className="mr-4">{toggleView.keys}</DropdownMenuShortcut>
            )}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="continuous">
            Continuous view
            {toggleView.keys && (
              <DropdownMenuShortcut className="mr-4">{toggleView.keys}</DropdownMenuShortcut>
            )}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Zoom {Math.round(zoom * 100)}%</DropdownMenuLabel>
        <ZoomItem command="view.zoomIn" label="Zoom in" disabled={zoom >= ZOOM.max} />
        <ZoomItem command="view.zoomOut" label="Zoom out" disabled={zoom <= ZOOM.min} />
        <ZoomItem command="view.zoomReset" label="Actual size" />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{track ? `Notation · ${track.name}` : 'Notation'}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={notation ?? ''}>
          {NOTATIONS.map((choice) => (
            <NotationItem
              key={choice}
              notation={choice}
              disabled={!choices.includes(choice)}
              active={notation === choice}
            />
          ))}
        </DropdownMenuRadioGroup>
        {limited && (
          <p id={reasonId} className="text-muted-foreground max-w-56 px-1.5 py-1 text-xs">
            {NO_TAB_REASON}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
