import { setTrackProperties, type Id, type SoundOverride, type Track } from '@reprise/model';
import { useId } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useSetting } from '@/app/use-setting';

import { curatedPack } from './curated-packs';
import { DEFAULT_SOUND_SETTINGS, soundFamilyOf } from './default-sounds';
import type { InstalledPack, PackInstrument } from './manifest';

/** No choice of its own: the family default from Settings plays (or the program, when that is GM). */
const DEFAULT = '';
/** An explicit General MIDI choice, stored as `sound.generalMidi`. */
const GENERAL_MIDI = 'gm';
/** A pack the track names that is not installed; it can never collide with `<12 chars>/<key>`. */
const MISSING = 'missing';

interface Choice {
  value: string;
  label: string;
  packId: string;
  /** Stored as `sound.instrument`; absent for a pack with one instrument. */
  instrument: string | undefined;
  /** The pack (or instrument) stands in for the track's General MIDI program, or its kit. */
  suggested: boolean;
}

/** One choice per instrument of a multi-instrument pack, one per pack otherwise. */
function choicesOf(pack: InstalledPack, track: Track): Choice[] {
  const [first] = pack.instruments;
  if (first === undefined) return [];
  const suggests = (instrument: PackInstrument): boolean => {
    if (track.kind === 'drums') return pack.family === 'drums';
    if (pack.family === 'drums') return false;
    return (instrument.gmPrograms ?? pack.gmPrograms).includes(track.program);
  };
  if (pack.instruments.length === 1) {
    return [
      {
        value: `${pack.id}/${first.key}`,
        label: pack.name,
        packId: pack.id,
        instrument: undefined,
        suggested: suggests(first),
      },
    ];
  }
  return pack.instruments.map((instrument) => ({
    value: `${pack.id}/${instrument.key}`,
    label: `${pack.name}: ${instrument.name}`,
    packId: pack.id,
    instrument: instrument.key,
    suggested: suggests(instrument),
  }));
}

/**
 * The track's sound with one choice set: a pack, `'gm'` (General MIDI, stored) or `'default'`
 * (nothing stored). `null` removes `sound` once nothing is left, so the effects preset survives.
 */
function soundWith(track: Track, choice: Choice | 'gm' | 'default'): SoundOverride | null {
  const next = { ...track.sound };
  delete next.packId;
  delete next.instrument;
  delete next.generalMidi;
  if (choice === 'gm') next.generalMidi = true;
  else if (choice !== 'default') {
    next.packId = choice.packId;
    if (choice.instrument !== undefined) next.instrument = choice.instrument;
  }
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * The track's sound: the family default (nothing stored), General MIDI (stored as
 * `generalMidi`), or an installed pack (one option per instrument of a multi-instrument pack). A change is one undoable edit of `Track.sound`, so it saves with the song.
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
  const scanned = useStore(sounds.api, (state) => state.scanned);
  const status = useStore(playback, (state) => state.trackSounds[trackId]);
  const defaultSound = useSetting(DEFAULT_SOUND_SETTINGS[track ? soundFamilyOf(track) : 'other']);
  const noticeId = useId();
  if (!track) return null;
  const name = label ?? (track.name || 'track');

  const choices = packs.flatMap((installed) => choicesOf(installed, track));
  const suggested = choices.filter((choice) => choice.suggested);
  const others = choices.filter((choice) => !choice.suggested);

  const { packId, instrument } = track.sound ?? {};
  const pack = packId === undefined ? undefined : packs.find((p) => p.id === packId);
  // `instrument === undefined` is the audio service's rule for "the pack's first instrument".
  const wanted = pack?.instruments.find((i) => i.key === instrument);
  const selectedKey =
    wanted?.key ?? (instrument === undefined ? pack?.instruments[0]?.key : undefined);
  let value = track.sound?.generalMidi === true ? GENERAL_MIDI : DEFAULT;
  let missing: string | undefined;
  if (packId !== undefined) {
    if (pack !== undefined && selectedKey !== undefined) {
      value = `${packId}/${selectedKey}`;
    } else {
      value = MISSING;
      // A removed curated pack is still named, so the user knows what to install again.
      const packName = pack?.name ?? curatedPack(packId)?.name ?? packId;
      missing = instrument === undefined ? packName : `${packName}: ${instrument}`;
    }
  }
  // A default that fails to load plays GM too; unlike a missing pack, that is worth saying.
  const failedDefault =
    packId === undefined && status?.source === 'default' && status.problem === 'failed';
  const failedText = `The sound pack could not be loaded: playing General MIDI${status?.message ? ` (${status.message})` : ''}`;
  const notice =
    missing !== undefined
      ? // Before the first scan the directory is empty, and every pack would read as removed.
        scanned
        ? `${missing} is not installed: playing General MIDI`
        : undefined
      : (packId !== undefined && status?.problem === 'failed' && status.packId === packId) ||
          failedDefault
        ? failedText
        : undefined;

  const gmLabel = generalMidi === undefined ? 'General MIDI' : `General MIDI (${generalMidi})`;
  // What the family default plays right now: an absent pack or instrument plays the program.
  const defaultPack =
    defaultSound === 'gm' ? undefined : packs.find((p) => p.id === defaultSound.packId);
  const defaultInstrument = defaultPack?.instruments.find(
    (i) =>
      defaultSound !== 'gm' &&
      (defaultSound.instrument === undefined || i.key === defaultSound.instrument),
  );
  const defaultLabel =
    defaultPack === undefined || defaultInstrument === undefined || failedDefault
      ? gmLabel
      : defaultPack.instruments.length === 1
        ? defaultPack.name
        : `${defaultPack.name}: ${defaultInstrument.name}`;

  const defaultText = `Default: ${defaultLabel}`;
  const options = (entries: readonly Choice[]) =>
    entries.map((choice) => (
      <option key={choice.value} value={choice.value}>
        {choice.label}
      </option>
    ));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <select
        aria-label={`Sound of ${name}`}
        aria-describedby={notice === undefined ? undefined : noticeId}
        value={value}
        className="border-input bg-background h-7 w-full min-w-0 rounded-md border px-1 text-xs"
        onChange={(event) => {
          const picked = event.target.value;
          const choice =
            picked === DEFAULT
              ? 'default'
              : picked === GENERAL_MIDI
                ? 'gm'
                : choices.find((c) => c.value === picked);
          if (choice === undefined) return;
          document
            .getState()
            .apply(setTrackProperties({ trackId }, { sound: soundWith(track, choice) }));
        }}
      >
        <option value={DEFAULT}>{defaultText}</option>
        <option value={GENERAL_MIDI}>{gmLabel}</option>
        {missing !== undefined && <option value={MISSING}>{missing} (not installed)</option>}
        {suggested.length > 0 && <optgroup label="Suggested">{options(suggested)}</optgroup>}
        {others.length > 0 && (
          <optgroup label={suggested.length > 0 ? 'Other packs' : 'Packs'}>
            {options(others)}
          </optgroup>
        )}
      </select>
      <span
        id={noticeId}
        aria-live="polite"
        className="text-muted-foreground text-xs empty:sr-only"
      >
        {notice}
      </span>
    </div>
  );
}
