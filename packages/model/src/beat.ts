import { z } from 'zod';

import { ChordSchema } from './chord-diagram';
import { IdSchema } from './id';
import { BendPointSchema, NoteSchema, VibratoSchema } from './note';
import { TempoMarkSchema } from './tempo';

/** The note value as a denominator: 1 whole, 2 half, 4 quarter, down to 256 as gpif allows. */
export const DurationSchema = z.literal([1, 2, 4, 8, 16, 32, 64, 128, 256]);
export type Duration = z.infer<typeof DurationSchema>;

export const DotsSchema = z.literal([0, 1, 2]);
export type Dots = z.infer<typeof DotsSchema>;

/** `n` notes in the time of `of`: a triplet is `{ n: 3, of: 2 }`. */
export const TupletSchema = z.object({
  n: z.int().min(1),
  of: z.int().min(1),
});
export type Tuplet = z.infer<typeof TupletSchema>;

export const StrokeDirectionSchema = z.enum(['up', 'down']);
export type StrokeDirection = z.infer<typeof StrokeDirectionSchema>;

export const StrokeSchema = z.object({
  direction: StrokeDirectionSchema,
  /** Spread of the stroke as a note-value denominator; absent = the reader's default. */
  duration: z.literal([4, 8, 16, 32, 64, 128]).exactOptional(),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const WhammyKindSchema = z.enum([
  'dive',
  'dip',
  'invertedDip',
  'return',
  'releaseUp',
  'releaseDown',
  'hold',
  'custom',
]);
export type WhammyKind = z.infer<typeof WhammyKindSchema>;

export const WhammySchema = z.object({
  kind: WhammyKindSchema,
  points: z.array(BendPointSchema).min(2),
});
export type Whammy = z.infer<typeof WhammySchema>;

export const BeatEffectsSchema = z.object({
  /** Stroke speed as a note-value denominator. */
  tremoloPicking: z.literal([8, 16, 32]).exactOptional(),
  pickStroke: StrokeDirectionSchema.exactOptional(),
  fadeIn: z.boolean().exactOptional(),
  fadeOut: z.boolean().exactOptional(),
  volumeSwell: z.boolean().exactOptional(),
  tapping: z.boolean().exactOptional(),
  slapping: z.boolean().exactOptional(),
  popping: z.boolean().exactOptional(),
  arpeggio: StrokeSchema.exactOptional(),
  brush: StrokeSchema.exactOptional(),
  vibrato: VibratoSchema.exactOptional(),
  whammy: WhammySchema.exactOptional(),
});
export type BeatEffects = z.infer<typeof BeatEffectsSchema>;

export const GraceBeatSchema = z.object({
  duration: z.literal([16, 32, 64]),
  /** Played before the beat's time position (true) or on it, stealing from the beat (false). */
  before: z.boolean(),
  notes: z.array(NoteSchema),
});
export type GraceBeat = z.infer<typeof GraceBeatSchema>;

/** Transition length in quarter notes; absent = immediate. */
const MixTransitionSchema = z.int().min(1).exactOptional();

export const ChannelMixChangeSchema = z.object({
  /** MIDI controller units, 0 to 127; pan 64 is centre. */
  value: z.int().min(0).max(127),
  duration: MixTransitionSchema,
  allTracks: z.boolean().exactOptional(),
});
export type ChannelMixChange = z.infer<typeof ChannelMixChangeSchema>;

export const TempoMixChangeSchema = TempoMarkSchema.extend({ duration: MixTransitionSchema });
export type TempoMixChange = z.infer<typeof TempoMixChangeSchema>;

export const MixerChangeSchema = z.object({
  program: z.int().min(0).max(127).exactOptional(),
  volume: ChannelMixChangeSchema.exactOptional(),
  pan: ChannelMixChangeSchema.exactOptional(),
  chorus: ChannelMixChangeSchema.exactOptional(),
  reverb: ChannelMixChangeSchema.exactOptional(),
  phaser: ChannelMixChangeSchema.exactOptional(),
  tremolo: ChannelMixChangeSchema.exactOptional(),
  tempo: TempoMixChangeSchema.exactOptional(),
});
export type MixerChange = z.infer<typeof MixerChangeSchema>;

export const LYRIC_LINES = 5;

export const BeatSchema = z.object({
  id: IdSchema,
  duration: DurationSchema,
  dots: DotsSchema,
  tuplet: TupletSchema.exactOptional(),
  rest: z.boolean(),
  /** Empty with `rest: false` is Guitar Pro's empty beat, an unfilled slot rather than a rest. */
  notes: z.array(NoteSchema),
  text: z.string().exactOptional(),
  chord: ChordSchema.exactOptional(),
  effects: BeatEffectsSchema,
  grace: z.array(GraceBeatSchema).exactOptional(),
  /** Mixer changes stored for import fidelity, applied by playback from this beat on. */
  mix: MixerChangeSchema.exactOptional(),
  /** One syllable per lyric line, index = line; `''` where a line has none on this beat. */
  lyrics: z.array(z.string()).max(LYRIC_LINES).exactOptional(),
});
export type Beat = z.infer<typeof BeatSchema>;
