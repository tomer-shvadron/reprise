import { useId } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { NOTATIONS, NotationRadioItems, ZoomItems } from '@/app/view-items';
import { DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import {
  effectiveNotation,
  NO_TAB_REASON,
  NOTATION_NAMES,
  notationChoices,
} from '@/features/tracks';

import { StatusMenu } from './segment';

/** The current track's notation; the menu picks another. Hidden with no score. */
export function NotationSegment() {
  const { document, selection } = useAppServices();
  const score = useStore(document, (state) => state.score);
  const byTrack = useStore(document, (state) => state.view.notation);
  const currentId = useStore(selection, (state) => state.currentTrack);
  const reasonId = useId();
  const track = score?.tracks.find((candidate) => candidate.id === currentId);
  if (!track) return null;
  const choices = notationChoices(track);
  const notation = effectiveNotation(track, byTrack);
  const limited = choices.length > 0 && choices.length < NOTATIONS.length;
  return (
    <StatusMenu
      label={`Notation of ${track.name}`}
      segment="notation"
      menuLabel="Notation"
      className="@max-[54rem]:hidden"
      describedBy={limited ? reasonId : undefined}
      menu={
        <>
          <DropdownMenuLabel>{`Notation · ${track.name}`}</DropdownMenuLabel>
          <NotationRadioItems choices={choices} notation={notation} />
          {limited && (
            <p id={reasonId} className="text-muted-foreground max-w-44 px-1.5 py-1 text-xs">
              {NO_TAB_REASON}
            </p>
          )}
        </>
      }
    >
      {NOTATION_NAMES[notation]}
    </StatusMenu>
  );
}

/** The zoom level; the menu zooms in, out or back to actual size. Always shown. */
export function ZoomSegment() {
  const { ui } = useAppServices();
  const zoom = useStore(ui, (state) => state.zoom);
  const percent = `${String(Math.round(zoom * 100))}%`;
  return (
    <StatusMenu
      label="Zoom"
      segment="zoom"
      menuLabel="Zoom"
      menu={
        <>
          <DropdownMenuLabel>Zoom {percent}</DropdownMenuLabel>
          <ZoomItems zoom={zoom} />
        </>
      }
    >
      {percent}
    </StatusMenu>
  );
}
