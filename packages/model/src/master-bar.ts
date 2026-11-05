import { z } from 'zod';

import { ColorSchema } from './color';
import { IdSchema } from './id';
import { TempoMarkSchema } from './tempo';

export const TimeSignatureSchema = z.object({
  numerator: z.int().min(1).max(32),
  denominator: z.literal([1, 2, 4, 8, 16, 32]),
});
export type TimeSignature = z.infer<typeof TimeSignatureSchema>;

export const KeySignatureSchema = z.object({
  /** Sharps as positive, flats as negative: -7 (Cb) to 7 (C#). */
  fifths: z.int().min(-7).max(7),
  minor: z.boolean(),
});
export type KeySignature = z.infer<typeof KeySignatureSchema>;

export const RepeatSchema = z.object({
  start: z.boolean(),
  /** Total plays of the repeated section, closed at this bar; 0 = no repeat end, 2 = play twice. */
  endCount: z.int().min(0),
});
export type Repeat = z.infer<typeof RepeatSchema>;

/** Jump instructions, read when playback reaches the end of the bar that carries one. */
export const JumpKindSchema = z.enum([
  'daCapo',
  'dcAlCoda',
  'dcAlDoubleCoda',
  'dcAlFine',
  'dalSegno',
  'dsAlCoda',
  'dsAlDoubleCoda',
  'dsAlFine',
  'dalSegnoSegno',
  'dssAlCoda',
  'dssAlDoubleCoda',
  'dssAlFine',
  'toCoda',
  'toDoubleCoda',
]);
export type JumpKind = z.infer<typeof JumpKindSchema>;

export const JumpSchema = z.object({ kind: JumpKindSchema });
export type Jump = z.infer<typeof JumpSchema>;

/** Places a jump lands on, or stops at (`fine`). */
export const DirectionTargetSchema = z.enum(['segno', 'segnoSegno', 'coda', 'doubleCoda', 'fine']);
export type DirectionTarget = z.infer<typeof DirectionTargetSchema>;

export const SectionSchema = z.object({
  name: z.string(),
  letter: z.string().exactOptional(),
  color: ColorSchema.exactOptional(),
});
export type Section = z.infer<typeof SectionSchema>;

export const TripletFeelSchema = z.enum([
  'none',
  'eighth',
  'sixteenth',
  'dottedEighth',
  'dottedSixteenth',
  'scottishEighth',
  'scottishSixteenth',
]);
export type TripletFeel = z.infer<typeof TripletFeelSchema>;

export const ALTERNATE_ENDING_MAX = 8;

export const MasterBarSchema = z.object({
  id: IdSchema,
  timeSignature: TimeSignatureSchema,
  keySignature: KeySignatureSchema,
  /** A tempo change at the start of this bar. */
  tempo: TempoMarkSchema.exactOptional(),
  repeat: RepeatSchema,
  /** Volta numbers this bar belongs to, ascending. */
  alternateEndings: z.array(z.int().min(1).max(ALTERNATE_ENDING_MAX)),
  /** Usually empty or one; applied in order when more than one. */
  jumps: z.array(JumpSchema),
  targets: z.array(DirectionTargetSchema),
  section: SectionSchema.exactOptional(),
  tripletFeel: TripletFeelSchema,
  doubleBar: z.boolean(),
  /** A pickup bar: shorter than its time signature, not counted and skipped by the count-in. */
  anacrusis: z.boolean(),
});
export type MasterBar = z.infer<typeof MasterBarSchema>;
