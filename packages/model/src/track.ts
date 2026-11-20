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
 * effects `preset`. With no `packId` the GM tier plays `program`. `instrument` is a key into the
 * pack's instruments, opaque to the model; absent means the pack's first (Black and Blue Basses
 * ships two basses, a drum pack several kits). It has no meaning without `packId` (#267).
 * `preset` is an effects preset id, opaque to the model: it is valid without `packId` (the track
 * keeps its GM instrument and takes the preset's effects chain), and an id the audio engine does
 * not know means automatic. The engine owns the ids (#234).
 */
export const SoundOverrideSchema = z.object({
  packId: IdSchema.exactOptional(),
  instrument: z.string().exactOptional(),
  preset: z.string().exactOptional(),
});
export type SoundOverride = z.infer<typeof SoundOverrideSchema>;

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
  /** Frets on the neck; 0 on drum tracks. */
  fretCount: z.int().min(0),
  /** GM program; on drum tracks the GM2 drum kit (0 standard), played on the percussion channel. */
  program: z.int().min(0).max(127),
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

const VOCAL_NAME = /\b(?:vocals?|vox|voices?|singer|choir)\b/i;

/**
 * Whether a track is a vocal part: a GM voice program, or a name containing the whole word
 * vocal(s), vox, voice(s), singer or choir (English only). Many files put the melody on a piano
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
