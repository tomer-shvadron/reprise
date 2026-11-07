import type { Notation, Track } from '@reprise/model';
import { cn } from 'cn';
import { memo } from 'react';

import { instrumentName } from './gm-programs';
import type { TrackActions } from './track-actions';
import {
  MuteToggle,
  NotationMenu,
  SoloToggle,
  TrackVolume,
  VisibilityToggle,
} from './track-controls';
import { trackLabel } from './track-model';

interface TrackRowProps {
  track: Track;
  index: number;
  muted: boolean;
  soloed: boolean;
  audible: boolean;
  current: boolean;
  visible: boolean;
  /** The only visible track, which cannot be hidden. */
  lastVisible: boolean;
  notation: Notation;
  /** Single-track view is on, which leaves the multitrack set alone. */
  single: boolean;
  loading: boolean;
  actions: TrackActions;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  muted,
  soloed,
  audible,
  current,
  visible,
  lastVisible,
  notation,
  single,
  loading,
  actions,
}: TrackRowProps) {
  const label = trackLabel(track, index);
  const disabledReason = single
    ? 'Turn on multitrack view to choose the tracks shown'
    : visible && lastVisible
      ? 'At least one track stays shown'
      : undefined;

  return (
    <li
      data-audible={audible}
      className={cn(
        'flex gap-2 border-b px-2 py-1.5',
        current && 'bg-sidebar-accent text-sidebar-accent-foreground muted-on-accent',
        !audible && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: track.color }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-current={current ? 'true' : undefined}
            className="min-w-0 flex-1 truncate text-left text-sm"
            onClick={() => {
              actions.selectTrack(track.id);
            }}
          >
            <span className="block truncate font-medium">{label}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {loading ? 'Loading…' : instrumentName(track)}
            </span>
          </button>
          <VisibilityToggle
            id={track.id}
            label={label}
            visible={visible}
            disabledReason={disabledReason}
            actions={actions}
          />
        </div>
        <div className="flex items-center gap-1">
          <MuteToggle id={track.id} label={label} pressed={muted} actions={actions} />
          <SoloToggle id={track.id} label={label} pressed={soloed} actions={actions} />
          <NotationMenu track={track} label={label} notation={notation} actions={actions} />
          <TrackVolume
            id={track.id}
            label={label}
            volume={track.channel.volume}
            actions={actions}
            compact
          />
        </div>
      </div>
    </li>
  );
});
