import { useEffect, useId, useMemo, useRef } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { MasterStrip } from './master-strip';
import { MixerStrip } from './mixer-strip';
import { useTrackActions } from './track-actions';
import { audibleTracks, effectiveMix } from './track-model';

/** The right panel's mixer: per-track instrument, volume, pan, mute and solo, and the master. */
export function MixerPanel() {
  const { document, selection, playback } = useAppServices();
  const actions = useTrackActions();
  const tracks = useStore(document, (state) => state.score?.tracks);
  const currentTrack = useStore(selection, (state) => state.currentTrack);
  const mixer = useStore(playback, (state) => state.mixer);
  const loads = useStore(playback, (state) => state.instrumentLoads);
  const audible = useMemo(() => tracks && audibleTracks(tracks, mixer), [tracks, mixer]);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);

  // Opening the panel puts the next Tab on its first control.
  useEffect(() => {
    section.current?.focus();
  }, []);

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <h2
        id={headingId}
        className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase"
      >
        Mixer
      </h2>
      {!tracks || !audible ? (
        <p className="text-muted-foreground flex-1 px-3 py-2 text-sm">
          Open a file to mix its tracks.
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="min-h-0 flex-1 overflow-y-auto border-t">
          {tracks.map((track, index) => {
            const mix = effectiveMix(track, mixer[track.id]);
            return (
              <MixerStrip
                key={track.id}
                track={track}
                index={index}
                muted={mix.mute}
                soloed={mix.solo}
                audible={audible.has(track.id)}
                current={track.id === currentTrack}
                load={loads[track.id]}
                actions={actions}
              />
            );
          })}
        </ul>
      )}
      <MasterStrip />
    </section>
  );
}
