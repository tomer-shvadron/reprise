import { z } from 'zod';

/** The note value a tempo mark is displayed against (gpif's 1 to 5); `bpm` stays per quarter note. */
export const TempoUnitSchema = z.enum(['eighth', 'quarter', 'dottedQuarter', 'half', 'dottedHalf']);
export type TempoUnit = z.infer<typeof TempoUnitSchema>;

export const TempoMarkSchema = z.object({
  /** Quarter-note beats per minute, whatever `unit` displays. */
  bpm: z.number().positive(),
  /** Display only; absent = quarter. "Dotted quarter = 80" is `{ bpm: 120, unit: 'dottedQuarter' }`. */
  unit: TempoUnitSchema.exactOptional(),
  label: z.string().exactOptional(),
});
export type TempoMark = z.infer<typeof TempoMarkSchema>;
