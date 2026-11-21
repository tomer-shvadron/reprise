import { ChevronDownIcon, EyeIcon } from 'lucide-react';
import { useId } from 'react';
import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useMenuFocusReturn } from '@/app/menu-focus-return';
import { useAppServices } from '@/app/services-context';
import { NOTATIONS, NotationRadioItems, ZoomItems } from '@/app/view-items';
import { useCommand } from '@/app/use-command';
import { useSetting } from '@/app/use-setting';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HintTooltip } from '@/app/command-tooltip';
import { CHORD_DIAGRAMS_SETTING } from '@/state/app-settings';
import { effectiveNotation, NO_TAB_REASON, notationChoices } from '@/features/tracks';

/** Layout, zoom and the current track's notation, each running its registered command. */
export function ViewMenu() {
  const { ui, document, selection } = useAppServices();
  const mode = useStore(ui, (state) => state.view.mode);
  const zoom = useStore(ui, (state) => state.zoom);
  const score = useStore(document, (state) => state.score);
  const notationByTrack = useStore(document, (state) => state.view.notation);
  const currentId = useStore(selection, (state) => state.currentTrack);
  const toggleView = useCommand('view.toggleViewMode');
  const toggleDiagrams = useCommand('view.toggleChordDiagrams');
  const diagrams = useSetting(CHORD_DIAGRAMS_SETTING);
  const track = score?.tracks.find((candidate) => candidate.id === currentId);
  const choices = track ? notationChoices(track) : [];
  const notation = track ? effectiveNotation(track, notationByTrack) : undefined;
  const limited = track !== undefined && choices.length > 0 && choices.length < NOTATIONS.length;
  const reasonId = useId();
  const focusReturn = useMenuFocusReturn();
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'view' },
    label: 'View',
  });

  return (
    <DropdownMenu>
      <HintTooltip label="View options">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            aria-label="View options"
            {...menu}
            onMouseDown={keepFocus}
            onPointerDownCapture={focusReturn.remember}
            onKeyDownCapture={focusReturn.remember}
          >
            <EyeIcon aria-hidden="true" />
            <span className="hidden whitespace-nowrap md:inline">View</span>
            <ChevronDownIcon aria-hidden="true" className="hidden md:block" />
          </Button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="end"
        className="w-60"
        aria-describedby={limited ? reasonId : undefined}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
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
        <DropdownMenuCheckboxItem
          checked={diagrams}
          onCheckedChange={() => {
            toggleDiagrams.run();
          }}
        >
          Chord diagrams
          {toggleDiagrams.keys && (
            <DropdownMenuShortcut className="mr-4">{toggleDiagrams.keys}</DropdownMenuShortcut>
          )}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Zoom {Math.round(zoom * 100)}%</DropdownMenuLabel>
        <ZoomItems zoom={zoom} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{track ? `Notation · ${track.name}` : 'Notation'}</DropdownMenuLabel>
        <NotationRadioItems choices={choices} notation={notation} />
        {limited && (
          <p id={reasonId} className="text-muted-foreground max-w-56 px-1.5 py-1 text-xs">
            {NO_TAB_REASON}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
