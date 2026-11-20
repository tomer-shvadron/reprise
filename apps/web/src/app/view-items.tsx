import type { Notation } from '@reprise/model';

import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { NOTATION_NAMES } from '@/features/tracks';
import { ZOOM } from '@/state/ui';

const NOTATION_COMMANDS: Record<Notation, RegisteredCommandId> = {
  tab: 'track.notationTab',
  standard: 'track.notationStandard',
  both: 'track.notationBoth',
};
export const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];

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

export function ZoomItem({
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

/** The three notation radio items; a choice the track cannot show is disabled. */
export function NotationRadioItems({
  choices,
  notation,
}: {
  choices: readonly Notation[];
  notation: Notation | undefined;
}) {
  return (
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
  );
}

/** Zoom in, zoom out and actual size, each disabled at its limit. */
export function ZoomItems({ zoom }: { zoom: number }) {
  return (
    <>
      <ZoomItem command="view.zoomIn" label="Zoom in" disabled={zoom >= ZOOM.max} />
      <ZoomItem command="view.zoomOut" label="Zoom out" disabled={zoom <= ZOOM.min} />
      <ZoomItem command="view.zoomReset" label="Actual size" />
    </>
  );
}
