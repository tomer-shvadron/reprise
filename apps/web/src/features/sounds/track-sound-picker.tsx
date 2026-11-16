import { setTrackProperties, type Id, type SoundOverride, type Track } from '@reprise/model';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import type { InstalledPack } from './manifest';

const GENERAL_MIDI = '';
/** A pack the track names that is not installed; it can never collide with `<12 chars>/<key>`. */
const MISSING = 'missing';

interface Choice {
  value: string;
  label: string;
  packId: string;
  /** Stored as `sound.instrument`; absent for a pack with one instrument. */
  instrument: string | undefined;
}

/** One choice per instrument of a multi-instrument pack, one per pack otherwise. */
function choicesOf(pack: InstalledPack): Choice[] {
  const [first] = pack.instruments;
  if (first === undefined) return [];
  if (pack.instruments.length === 1) {
    return [
      {
        value: `${pack.id}/${first.key}`,
        label: pack.name,
        packId: pack.id,
        instrument: undefined,
      },
    ];
  }
  return pack.instruments.map((instrument) => ({
    value: `${pack.id}/${instrument.key}`,
    label: `${pack.name}: ${instrument.name}`,
    packId: pack.id,
    instrument: instrument.key,
  }));
}

/** Whether the pack suggests itself for the track: a drum pack on a drum track, or its programs. */
function suggests(pack: InstalledPack, track: Track): boolean {
  if (track.kind === 'drums') return pack.family === 'drums';
  if (pack.family === 'drums') return false;
  return pack.gmPrograms.includes(track.program);
}

/** The track's sound with the pack set or removed; `null` removes `sound` once nothing is left. */
function soundWith(track: Track, choice: Choice | undefined): SoundOverride | null {
  const next = { ...track.sound };
  delete next.packId;
  delete next.instrument;
  if (choice !== undefined) {
    next.packId = choice.packId;
    if (choice.instrument !== undefined) next.instrument = choice.instrument;
  }
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * The track's sound: General MIDI, or an installed pack (one option per instrument of a
 * multi-instrument pack). A change is one undoable edit of `Track.sound`, so it saves with the song.
 * A pack the song names that is not installed stays selected, with a notice: the track plays
 * General MIDI until the pack is installed again, and the score is never edited for it.
 *
 * `generalMidi` is the name of the track's General MIDI instrument, which the mixer supplies.
 */
export function TrackSoundPicker({
  trackId,
  label,
  generalMidi,
}: {
  trackId: Id;
  label?: string;
  generalMidi?: string;
}) {
  const { document, playback, sounds } = useAppServices();
  const track = useStore(document, (state) => state.score?.tracks.find((t) => t.id === trackId));
  const packs = useStore(sounds.api, (state) => state.packs);
  const status = useStore(playback, (state) => state.trackSounds[trackId]);
  if (!track) return null;
  const name = label ?? (track.name || 'track');

  const all = packs.flatMap((pack) => ({ pack, choices: choicesOf(pack) }));
  const choices = all.flatMap((entry) => entry.choices);
  const suggested = all.filter((entry) => suggests(entry.pack, track));
  const others = all.filter((entry) => !suggests(entry.pack, track));

  const packId = track.sound?.packId;
  const pack = packId === undefined ? undefined : packs.find((p) => p.id === packId);
  const wanted = pack?.instruments.find((i) => i.key === track.sound?.instrument);
  const selectedKey = wanted?.key ?? pack?.instruments[0]?.key;
  let value = GENERAL_MIDI;
  let missing: string | undefined;
  if (packId !== undefined) {
    if (pack !== undefined && selectedKey !== undefined && (wanted || !track.sound?.instrument)) {
      value = `${packId}/${selectedKey}`;
    } else {
      value = MISSING;
      missing = `${pack?.name ?? packId}${track.sound?.instrument ? `: ${track.sound.instrument}` : ''}`;
    }
  }
  const notice =
    missing !== undefined
      ? `${missing} is not installed: playing General MIDI`
      : status?.problem === 'failed'
        ? `The sound pack could not be loaded: playing General MIDI${status.message ? ` (${status.message})` : ''}`
        : undefined;

  const options = (entries: typeof all) =>
    entries.flatMap((entry) =>
      entry.choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      )),
    );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <select
        aria-label={`Sound of ${name}`}
        value={value}
        className="border-input bg-background h-7 w-full min-w-0 rounded-md border px-1 text-xs"
        onChange={(event) => {
          const choice = choices.find((c) => c.value === event.target.value);
          if (event.target.value !== GENERAL_MIDI && choice === undefined) return;
          document
            .getState()
            .apply(setTrackProperties({ trackId }, { sound: soundWith(track, choice) }));
        }}
      >
        <option value={GENERAL_MIDI}>
          {generalMidi === undefined ? 'General MIDI' : `General MIDI (${generalMidi})`}
        </option>
        {missing !== undefined && <option value={MISSING}>{missing} (not installed)</option>}
        {suggested.length > 0 && <optgroup label="Suggested">{options(suggested)}</optgroup>}
        {others.length > 0 && (
          <optgroup label={suggested.length > 0 ? 'Other packs' : 'Packs'}>
            {options(others)}
          </optgroup>
        )}
      </select>
      {notice !== undefined && <span className="text-muted-foreground text-xs">{notice}</span>}
    </div>
  );
}
