import { z } from 'zod';

import { BarSchema, ClefSchema } from './bar';
import { LYRIC_LINES } from './beat';
import { ColorSchema } from './color';
import { IdSchema } from './id';

export const TrackKindSchema = z.enum(['fretted', 'drums', 'pitched']);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const MAX_STRINGS = 10;

const ControllerSchema = z.int().min(0).max(127);

/** MIDI controller units, 0 to 127; pan 64 is centre. */
export const ChannelSettingsSchema = z.object({
  volume: ControllerSchema,
  pan: ControllerSchema,
  chorus: ControllerSchema,
  reverb: ControllerSchema,
  phaser: ControllerSchema,
  tremolo: ControllerSchema,
  mute: z.boolean(),
  solo: z.boolean(),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

export const NotationSchema = z.enum(['tab', 'standard', 'both']);
export type Notation = z.infer<typeof NotationSchema>;

export const DisplaySettingsSchema = z.object({
  notation: NotationSchema,
  clef: ClefSchema.exactOptional(),
  /** Written minus sounding, in octaves: 1 for guitar and bass, which are written an octave up. */
  octaveShift: z.int(),
});
export type DisplaySettings = z.infer<typeof DisplaySettingsSchema>;

/**
 * The track's sound choice: an optional HQ `packId`, an optional `instrument` and an optional
 * effects `preset`. With no `packId` the track plays the app's family default for its instrument family, which is General MIDI (`program`) unless the user set a pack for the family or `generalMidi` is set. `instrument` is a key into the
 * pack's instruments, opaque to the model; absent means the pack's first (Black and Blue Basses
 * ships two basses, a drum pack several kits). It has no meaning without `packId` (#267).
 * `preset` is an effects preset id, opaque to the model: it is valid without `packId` (the track
 * keeps whatever instrument it would otherwise play, its family default or GM program, and takes the
 * preset's effects chain), and an id the audio engine does
 * not know means automatic. The engine owns the ids (#234).
 * `generalMidi` is an explicit "play the GM program here" for a track whose instrument family has
 * a default pack in the app's settings: without it, an absent `packId` means "the default". It is
 * ignored when `packId` is set (#346).
 */
export const SoundOverrideSchema = z.object({
  packId: IdSchema.exactOptional(),
  instrument: z.string().exactOptional(),
  preset: z.string().exactOptional(),
  generalMidi: z.literal(true).exactOptional(),
});
export type SoundOverride = z.infer<typeof SoundOverrideSchema>;

/**
 * A short string that starts partway up the neck, as on a 5-string banjo: `string` is 1-based
 * (1 = highest) and `fret` is the neck fret it starts at (banjo: string 5, fret 5). Frets on that
 * string are stored from its own nut, so `midiNote` is unchanged; `writtenFret` gives the neck
 * fret (#348).
 */
export const DroneSchema = z.object({
  string: z.int().min(1).max(MAX_STRINGS),
  fret: z.int().min(1),
});
export type Drone = z.infer<typeof DroneSchema>;

/** The widest course offset in semitones; a 12-string needs 12, this leaves room for others. */
export const MAX_COURSE_OFFSET = 24;

/** One lyric line as Guitar Pro stores it: a text block starting at a master bar. */
export const LyricLineSchema = z.object({
  /** 0-based master-bar index; GP files store it 1-based. */
  startBar: z.int().min(0),
  text: z.string(),
});
export type LyricLine = z.infer<typeof LyricLineSchema>;

export const TrackSchema = z.object({
  id: IdSchema,
  name: z.string(),
  shortName: z.string(),
  color: ColorSchema,
  kind: TrackKindSchema,
  /**
   * Open-string MIDI notes, lowest string first (string N first). Empty on drum tracks. A GP3 to
   * GP5 keyboard track (program outside GM 24 to 39 and 104 to 107, not a drum track by its
   * percussion flag or MIDI channel 10) is read as `pitched` with its notes converted to MIDI
   * through this tuning, which it keeps, with `capo` and `fretCount`, so gp5 export can
   * re-finger it, unless its file flags tablature (or it is a vocal track the file gives no
   * notation), which keeps it `fretted`.
   */
  tuning: z.array(z.int().min(0).max(127)).max(MAX_STRINGS),
  capo: z.int().min(0),
  /**
   * Doubled courses (12-string guitar, mandolin), one entry per string in `tuning` order and
   * length: the semitone offset of the course's second string from the first (0 unison, 12 an
   * octave above, -12 an octave below), or `null` for a single string. Absent means every string
   * is single. Notation shows the fundamental only; playback sounds both strings (#348).
   */
  courses: z
    .array(z.int().min(-MAX_COURSE_OFFSET).max(MAX_COURSE_OFFSET).nullable())
    .max(MAX_STRINGS)
    .exactOptional(),
  /**
   * A short drone string, as on a 5-string banjo. Absent means no short string. Frets on that
   * string are stored from its own nut; see `DroneSchema` (#348).
   */
  drone: DroneSchema.exactOptional(),
  /** Frets on the neck; 0 on drum tracks. */
  fretCount: z.int().min(0),
  /** GM program; on drum tracks the GM2 drum kit (0 standard), played on the percussion channel. */
  program: z.int().min(0).max(127),
  /**
   * MIDI bank, 14-bit (`(msb << 7) | lsb`, 0 to 16383) as a gpif file stores it; a gp3 to gp5 file's
   * single byte is kept as read, an MSB value. The sampler maps it to the soundfont's bank
   * (`soundfontBankOf` in `@reprise/audio`), so the model never converts it.
   */
  bank: z.int().min(0).max(16383),
  channel: ChannelSettingsSchema,
  display: DisplaySettingsSchema,
  sound: SoundOverrideSchema.exactOptional(),
  /** The raw lyric block, one entry per line, kept next to the per-beat `Beat.lyrics`. */
  lyrics: z.array(LyricLineSchema).max(LYRIC_LINES),
  /** One per master bar, same order. */
  bars: z.array(BarSchema),
});
export type Track = z.infer<typeof TrackSchema>;

/**
 * Whether the track can be shown as tab. Only a fretted track's notes sit on strings: a pitched
 * track's are MIDI pitches on string 0, even when it keeps a GP3 to GP5 keyboard part's tuning.
 */
export function canShowTab(track: Pick<Track, 'kind' | 'tuning'>): boolean {
  return track.kind === 'fretted' && track.tuning.length > 0;
}

/** General MIDI voice programs: choir aahs, voice oohs and synth voice. */
export const VOCAL_PROGRAMS: readonly number[] = [52, 53, 54];

// Letter lookarounds, not `\b`: digits and `_` are word characters there, and "Vocals2" or
// "Lead_Vocals" are vocal tracks while "Voiceover", "Invoice" and "Vocalist" are not.
const VOCAL_NAME = /(?<![a-z])(?:vocals?|vox|voices?|singers?|choirs?)(?![a-z])/i;

/**
 * Whether a track is a vocal part: a GM voice program, or a name containing the whole word
 * vocal(s), vox, voice(s), singer(s) or choir(s), bounded by non-letters (English only). The
 * name counts whatever the program, so "Vox Guitar" on a guitar program is vocal too: a melody
 * named "Vocals" on a guitar sound is a common way to tab the vocal line. Many files put the melody on a piano
 * or flute program and name it "Vocals", so the program alone would miss them. Never true for
 * drums.
 */
export function isVocalTrack(track: Pick<Track, 'kind' | 'program' | 'name'>): boolean {
  if (track.kind === 'drums') return false;
  return VOCAL_PROGRAMS.includes(track.program) || VOCAL_NAME.test(track.name);
}

/**
 * The notation a track asking for `wanted` is drawn in: `standard` when it cannot show tab. Drums
 * get `wanted` back unchanged; layout gives them a percussion staff whatever it says.
 */
export function shownNotation(track: Pick<Track, 'kind' | 'tuning'>, wanted: Notation): Notation {
  return track.kind === 'drums' || canShowTab(track) ? wanted : 'standard';
}

export type StringInstrument = 'twelveString' | 'mandolin' | 'banjo';

/** General MIDI banjo. */
const BANJO_PROGRAM = 105;

/**
 * What kind of string instrument a fretted track is, derived and never stored, so the sound
 * family, the gp writer and the track dialog ask one place. `banjo`: a drone, or a fretted track
 * on program 105. `twelveString`: any course an octave away. `mandolin`: four strings, every one a
 * unison course. `undefined` for every other track (#348).
 */
export function stringInstrumentOf(
  track: Pick<Track, 'kind' | 'program' | 'tuning' | 'courses' | 'drone'>,
): StringInstrument | undefined {
  if (track.kind !== 'fretted') return undefined;
  if (track.drone !== undefined || track.program === BANJO_PROGRAM) return 'banjo';
  const { courses } = track;
  if (courses?.some((offset) => offset === 12 || offset === -12)) return 'twelveString';
  if (
    track.tuning.length === 4 &&
    courses?.length === 4 &&
    courses.every((offset) => offset === 0)
  ) {
    return 'mandolin';
  }
  return undefined;
}
