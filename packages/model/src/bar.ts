import { z } from 'zod';

import { BeatSchema } from './beat';
import { IdSchema } from './id';

export const ClefSchema = z.enum(['treble', 'bass', 'alto', 'tenor', 'percussion']);
export type Clef = z.infer<typeof ClefSchema>;

export const VoiceSchema = z.object({
  id: IdSchema,
  beats: z.array(BeatSchema),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const VOICE_COUNT = 4;

export const BarSchema = z.object({
  id: IdSchema,
  /** Always four, as Guitar Pro stores them; unused voices have no beats. */
  voices: z.tuple([VoiceSchema, VoiceSchema, VoiceSchema, VoiceSchema]),
  /** A clef change from this bar on; absent = the track's display clef. */
  clef: ClefSchema.exactOptional(),
});
export type Bar = z.infer<typeof BarSchema>;
