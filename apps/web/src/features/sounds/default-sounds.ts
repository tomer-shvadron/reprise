import { IdSchema, stringInstrumentOf, type Track } from '@reprise/model';
import { z } from 'zod';

import type { DefaultSounds } from '@/state/sound-packs';
import { defineSetting, type SettingDef, type SettingsStore } from '@/state/settings';

import { PACK_FAMILIES, type PackFamily } from './manifest';

/**
 * The instrument family of a track, which picks its default sound. Drums come from the track's
 * kind, never its program: a Guitar Pro drum track carries a meaningless one. The rest follow the
 * GM program groups: 0-23 keys, 24-25 acoustic guitar, 26-31 electric guitar, 32-39 bass, 40-79
 * orchestral, everything else other. The file's program only picks the family; it is never a
 * choice, because every track has one (#346).
 */
export function soundFamilyOf(
  track: Pick<Track, 'kind' | 'program'> & Partial<Pick<Track, 'tuning' | 'courses' | 'drone'>>,
): PackFamily {
  if (track.kind === 'drums') return 'drums';
  // A banjo, a ukulele and a mandolin are not a guitar, whatever program they carry (a mandolin
  // sits on 25, the steel guitar; a ukulele on 24), so the Emilyguitar default never captures
  // them. A ukulele then plays GeneralUser's Ukulele. A 12-string is a guitar: it follows its
  // program's family, and the engine doubles its courses.
  const instrument = stringInstrumentOf({ ...track, tuning: track.tuning ?? [] });
  if (instrument === 'banjo' || instrument === 'mandolin' || instrument === 'ukulele') {
    return 'other';
  }
  const { program } = track;
  if (program <= 23) return 'keys';
  if (program <= 25) return 'acoustic-guitar';
  if (program <= 31) return 'electric-guitar';
  if (program <= 39) return 'bass';
  if (program <= 79) return 'orchestral';
  return 'other';
}

/** `gm` plays the track's General MIDI program; a pack names an installed pack's instrument. */
export const DefaultSoundSchema = z.union([
  z.literal('gm'),
  z.object({ packId: IdSchema, instrument: z.string().min(1).exactOptional() }),
]);
export type DefaultSound = z.infer<typeof DefaultSoundSchema>;

/** Karoryfer Emilyguitar, its "Five voices" instrument: the default of both guitar families. */
export const EMILYGUITAR_FIVE_VOICES = {
  packId: 'qxmLveBRBWt8',
  instrument: 'five-voices',
} as const;

const camel = (family: PackFamily): string =>
  family.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const defaultFor = (family: PackFamily): DefaultSound =>
  family === 'electric-guitar' || family === 'acoustic-guitar' ? EMILYGUITAR_FIVE_VOICES : 'gm';

/** One handle per family, keyed `sounds.default.<family>` in camelCase. */
export const DEFAULT_SOUND_SETTINGS: Readonly<Record<PackFamily, SettingDef<DefaultSound>>> =
  Object.fromEntries(
    PACK_FAMILIES.map((family) => [
      family,
      defineSetting({
        key: `sounds.default.${camel(family)}`,
        schema: DefaultSoundSchema,
        default: defaultFor(family),
      }),
    ]),
  ) as Record<PackFamily, SettingDef<DefaultSound>>;

/** The curated packs the one-time download offer has already shown (#346, used by the offer). */
export const OFFERED_PACKS_SETTING = defineSetting({
  key: 'sounds.offeredPacks',
  schema: z.array(IdSchema),
  default: [],
});

/** The family defaults as the audio service reads them; it follows every handle. */
export function createDefaultSounds(settings: SettingsStore): DefaultSounds {
  return {
    get(track) {
      const choice = settings.get(DEFAULT_SOUND_SETTINGS[soundFamilyOf(track)]);
      if (choice === 'gm') return undefined;
      return choice.instrument === undefined
        ? { packId: choice.packId }
        : { packId: choice.packId, instrument: choice.instrument };
    },
    subscribe(listener) {
      const offs = PACK_FAMILIES.map((family) =>
        settings.subscribe(DEFAULT_SOUND_SETTINGS[family], () => {
          listener();
        }),
      );
      return () => {
        for (const off of offs) off();
      };
    },
  };
}
