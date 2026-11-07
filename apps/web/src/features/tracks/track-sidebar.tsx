import { LayersIcon } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useStore } from 'zustand';

import type { CommandRegistry } from '@/app/command-registry';
import type { KeyboardPlatform } from '@/app/keyboard';
import { useAppServices } from '@/app/services-context';
import { CommandSourceContext, useCommand } from '@/app/use-command';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { singleTrackOf } from '@/state/document';

import { useTrackActions } from './track-actions';
import { TrackRow } from './track-row';
import { audibleTracks, effectiveMix, effectiveNotation, visibleSet } from './track-model';

interface TrackSidebarProps {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}

function MultitrackToggle({ single, disabled }: { single: boolean; disabled: boolean }) {
  const command = useCommand('view.toggleMultitrack');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          aria-label="Multitrack view"
          aria-keyshortcuts={command.ariaKeys}
          pressed={!single}
          disabled={disabled}
          onPressedChange={command.run}
        >
          <LayersIcon />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>
        Multitrack view{command.keys !== undefined && ` (${command.keys})`}
      </TooltipContent>
    </Tooltip>
  );
}

function TrackList() {
  const { document, selection, playback } = useAppServices();
  const actions = useTrackActions();
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const opening = useStore(document, (state) => state.opening);
  const currentTrack = useStore(selection, (state) => state.currentTrack);
  const mixer = useStore(playback, (state) => state.mixer);
  const loads = useStore(playback, (state) => state.instrumentLoads);
  const headingId = useId();
  const tracks = score?.tracks;
  const audible = useMemo(() => tracks && audibleTracks(tracks, mixer), [tracks, mixer]);
  const shown = useMemo(() => tracks && visibleSet(tracks, view.tracks), [tracks, view.tracks]);
  const single = singleTrackOf(view, score) !== undefined;

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1">
        <h2
          id={headingId}
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
        >
          Tracks
        </h2>
        <MultitrackToggle single={single} disabled={!score} />
      </div>
      {!tracks || !audible || !shown ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">
          {opening === undefined ? 'No file open.' : `Opening ${opening}…`}
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="min-h-0 flex-1 overflow-y-auto border-t">
          {tracks.map((track, index) => {
            const mix = effectiveMix(track, mixer[track.id]);
            const visible = shown.has(track.id);
            return (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                muted={mix.mute}
                soloed={mix.solo}
                audible={audible.has(track.id)}
                current={track.id === currentTrack}
                visible={visible}
                lastVisible={shown.size === 1}
                notation={effectiveNotation(track, view.notation)}
                single={single}
                loading={loads[track.id] !== undefined}
                actions={actions}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The left sidebar: every track with its mute, solo, volume, notation and visibility. */
export function TrackSidebar({ registry, keyboard }: TrackSidebarProps) {
  const source = useMemo(() => ({ registry, keyboard }), [registry, keyboard]);
  return (
    <CommandSourceContext value={source}>
      <TrackList />
    </CommandSourceContext>
  );
}
