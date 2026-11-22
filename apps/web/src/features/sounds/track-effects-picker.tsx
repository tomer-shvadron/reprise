import { setTrackProperties, type Id, type SoundOverride, type Track } from '@reprise/model';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import { automaticLabel, chosenPreset, PRESET_CHOICES, presetLabel } from './effects-labels';

const AUTOMATIC = '';

/**
 * The track's effects preset: "Automatic" follows the track's instrument family, the rest are
 * stored as `sound.preset`. A change is one undoable edit that takes effect at once, with no
 * rebuild of the song.
 */
export function TrackEffectsPicker({ trackId, label }: { trackId: Id; label?: string }) {
  const { document, playback } = useAppServices();
  const track = useStore(document, (state) => state.score?.tracks.find((t) => t.id === trackId));
  const gmTierBypass = useStore(playback, (state) => state.settings.gmTierBypass);
  const channelEffects = useStore(playback, (state) => state.settings.channelEffects);
  const tier = useStore(playback, (state) => state.trackSounds[trackId]?.tier ?? 'gm');
  if (!track) return null;
  const name = label ?? (track.name || 'track');

  return (
    <select
      aria-label={`Effects of ${name}`}
      value={chosenPreset(track) ?? AUTOMATIC}
      className="border-input bg-background h-7 w-full min-w-0 rounded-md border px-1 text-xs"
      onChange={(event) => {
        const next = PRESET_CHOICES.find((id) => id === event.target.value);
        document
          .getState()
          .apply(setTrackProperties({ trackId }, { sound: soundWith(track, next) }));
      }}
    >
      <option value={AUTOMATIC}>{automaticLabel(track, gmTierBypass, tier, channelEffects)}</option>
      {PRESET_CHOICES.map((id) => (
        <option key={id} value={id}>
          {presetLabel(id)}
        </option>
      ))}
    </select>
  );
}

/** The track's sound with `preset` set or removed; `null` removes `sound` once nothing is left. */
function soundWith(track: Track, preset: string | undefined): SoundOverride | null {
  const next = { ...track.sound };
  if (preset === undefined) delete next.preset;
  else next.preset = preset;
  return Object.keys(next).length === 0 ? null : next;
}
