import type { Track } from '@reprise/model';
import { EllipsisIcon, PlusIcon } from 'lucide-react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  LAST_TRACK_REASON,
  canMoveTrack,
  moveTrackBy,
  openTrackProperties,
  requestRemoveTrack,
} from './track-edit';

/** The sidebar's "+": the same command as the palette and the shortcut. */
export function AddTrackButton() {
  const { document } = useAppServices();
  const open = useStore(document, (state) => state.score !== undefined);
  // The mac and Windows bindings are two commands with one title; only one prints keys per platform.
  const mac = useCommand('track.add');
  const other = useCommand('track.addWindows');
  const keys = mac.keys ?? other.keys;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add track"
          aria-keyshortcuts={mac.ariaKeys ?? other.ariaKeys}
          disabled={!open}
          onClick={mac.run}
        >
          <PlusIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Add track{keys !== undefined && ` (${keys})`}</TooltipContent>
    </Tooltip>
  );
}

/** The "⋯" at the end of a track row: properties, order and removal, by pointer or keyboard. */
export function TrackRowMenu({ track, index }: { track: Track; index: number }) {
  const services = useAppServices();
  const count = useStore(services.document, (state) => state.score?.tracks.length ?? 0);
  const label = track.name || `Track ${String(index + 1)}`;
  const last = count <= 1;
  // Read when the menu opens, as the items are rendered then.
  const can = (delta: -1 | 1) => canMoveTrack(services, track.id, delta);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Track actions for ${label}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            openTrackProperties(services, track.id);
          }}
        >
          Properties…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!can(-1)}
          onSelect={() => {
            moveTrackBy(services, track.id, -1);
          }}
        >
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!can(1)}
          onSelect={() => {
            moveTrackBy(services, track.id, 1);
          }}
        >
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={last}
          onSelect={() => {
            requestRemoveTrack(services, track.id);
          }}
        >
          Remove…
          {last && <span className="text-muted-foreground ml-1 text-xs">{LAST_TRACK_REASON}</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
