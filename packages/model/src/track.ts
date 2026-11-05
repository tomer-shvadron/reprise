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

/** The HQ sound tier's assignment; absent = the GM tier plays `program`. */
export const SoundOverrideSchema = z.object({
  packId: IdSchema.exactOptional(),
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
   * Open-string MIDI notes, lowest string first (string N first). Empty on drum tracks. A GP5
   * keyboard track (program outside GM 24 to 39 and 104 to 107, channel not percussion) is read
   * as `pitched` with its notes converted to MIDI through this tuning, which it keeps, with
   * `fretCount`, so gp5 export can re-finger it.
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
