import type { PackAssignment } from '@reprise/audio';
import type { Track } from '@reprise/model';

import type { TrackSound } from '@/state/playback';
import type { DefaultSounds, PackDirectory } from '@/state/sound-packs';

/** What one track plays before the engine loads it: an assignment, or General MIDI. */
export interface ResolvedTrackSound {
  /** Present when a pack that is installed, with the wanted instrument, plays the track. */
  assignment?: PackAssignment;
  /** `gm` tier; the audio service raises it to `hq` once the pack is known to play. */
  sound: TrackSound;
}

/**
 * Which sound a track gets, highest first: a pack it names (`sound.packId`, saved with the
 * song), an explicit General MIDI choice (`sound.generalMidi`), the family default from the
 * settings, then the track's own GM program. A default is never written into the song, and its
 * pack being absent is silent: the track plays GM and the entry carries `source: 'default'`, so
 * nothing shows it as a problem while the one-time download offer can still find it.
 */
export function resolveTrackSound(
  track: Track,
  directory: Pick<PackDirectory, 'get'>,
  defaults: DefaultSounds | undefined,
): ResolvedTrackSound {
  const named = track.sound?.packId;
  if (named !== undefined) return resolveWanted(track, directory, named, track.sound?.instrument);
  if (track.sound?.generalMidi === true) return { sound: { tier: 'gm' } };
  const wanted = defaults?.get(track);
  if (!wanted) return { sound: { tier: 'gm' } };
  return resolveWanted(track, directory, wanted.packId, wanted.instrument, 'default');
}

function resolveWanted(
  track: Track,
  directory: Pick<PackDirectory, 'get'>,
  packId: string,
  instrument: string | undefined,
  source?: 'default',
): ResolvedTrackSound {
  const pack = directory.get(packId);
  const chosen = pack?.instruments.find(
    (entry) => instrument === undefined || entry.key === instrument,
  );
  const tag = source === undefined ? {} : { source };
  if (!pack || !chosen) {
    return { sound: { tier: 'gm', packId, problem: 'missing', ...tag } };
  }
  return {
    assignment: {
      trackId: track.id,
      pack: { id: pack.id, files: pack.files },
      entries: chosen.entries,
    },
    sound: { tier: 'gm', packId, ...tag },
  };
}
