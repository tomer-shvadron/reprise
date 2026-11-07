import type { Track } from '@reprise/model';
import { cn } from 'cn';
import { memo, useId } from 'react';

import type { InstrumentLoad } from '@/state/playback';

import type { TrackActions } from './track-actions';
import {
  InstrumentSelect,
  InstrumentStatus,
  MuteToggle,
  SoloToggle,
  TrackPan,
  TrackVolume,
} from './track-controls';
import { trackLabel } from './track-model';

interface MixerStripProps {
  track: Track;
  index: number;
  muted: boolean;
  soloed: boolean;
  audible: boolean;
  current: boolean;
  load: InstrumentLoad | undefined;
  actions: TrackActions;
}

const rowLabel = 'text-muted-foreground w-16 shrink-0 text-xs';

export const MixerStrip = memo(function MixerStrip({
  track,
  index,
  muted,
  soloed,
  audible,
  current,
  load,
  actions,
}: MixerStripProps) {
  const label = trackLabel(track, index);
  const nameId = useId();

  return (
    <li>
      <div
        role="group"
        aria-labelledby={nameId}
        data-audible={audible}
        className={cn(
          'flex flex-col gap-1.5 border-b px-3 py-2',
          current && 'bg-sidebar-accent text-sidebar-accent-foreground muted-on-accent',
          !audible && 'text-muted-foreground',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-4 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: track.color }}
          />
          <span id={nameId} className="min-w-0 flex-1 truncate text-sm font-medium">
            {label}
          </span>
          <MuteToggle id={track.id} label={label} pressed={muted} actions={actions} />
          <SoloToggle id={track.id} label={label} pressed={soloed} actions={actions} />
        </div>
        <div className="flex items-center gap-2">
          <span className={rowLabel}>Instrument</span>
          <InstrumentSelect track={track} label={label} actions={actions} />
        </div>
        <div className="flex items-center gap-2">
          <span className={rowLabel}>Volume</span>
          <TrackVolume
            id={track.id}
            label={label}
            volume={track.channel.volume}
            actions={actions}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={rowLabel}>Pan</span>
          <TrackPan id={track.id} label={label} pan={track.channel.pan} actions={actions} />
        </div>
        <InstrumentStatus load={load} />
      </div>
    </li>
  );
});
