import { z } from 'zod';

import { IdSchema } from './id';

export const DynamicsSchema = z.enum(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);
export type Dynamics = z.infer<typeof DynamicsSchema>;

export const AccentSchema = z.enum(['none', 'accent', 'heavy']);
export type Accent = z.infer<typeof AccentSchema>;

export const VibratoSchema = z.enum(['none', 'slight', 'wide']);
export type Vibrato = z.infer<typeof VibratoSchema>;

export const FingerSchema = z.enum(['thumb', 'index', 'middle', 'ring', 'little']);
export type Finger = z.infer<typeof FingerSchema>;

export const AccidentalSchema = z.enum(['doubleFlat', 'flat', 'natural', 'sharp', 'doubleSharp']);
export type Accidental = z.infer<typeof AccidentalSchema>;

/** GP units: `position` 0 to 60 across the note's duration, `value` in quarter tones (GP raw value / 25). */
export const BendPointSchema = z.object({
  position: z.number().min(0).max(60),
  value: z.number(),
});
export type BendPoint = z.infer<typeof BendPointSchema>;

export const BendKindSchema = z.enum([
  'bend',
  'bendRelease',
  'bendReleaseBend',
  'prebend',
  'prebendBend',
  'prebendRelease',
  'release',
  'hold',
  'custom',
]);
export type BendKind = z.infer<typeof BendKindSchema>;

export const BendSchema = z.object({
  kind: BendKindSchema,
  points: z.array(BendPointSchema).min(2),
});
export type Bend = z.infer<typeof BendSchema>;

export const SlideKindSchema = z.enum([
  'shift',
  'legato',
  'intoFromBelow',
  'intoFromAbove',
  'outDown',
  'outUp',
]);
export type SlideKind = z.infer<typeof SlideKindSchema>;

export const HarmonicKindSchema = z.enum([
  'natural',
  'artificial',
  'tapped',
  'pinch',
  'semi',
  'feedback',
]);
export type HarmonicKind = z.infer<typeof HarmonicKindSchema>;

export const HarmonicSchema = z.object({
  kind: HarmonicKindSchema,
  /** The harmonic's fret position, fractional for in-between nodes (2.7, 3.2, 5.8). */
  value: z.number().min(0).exactOptional(),
});
export type Harmonic = z.infer<typeof HarmonicSchema>;

export const TrillSchema = z.object({
  /** The alternate fret, or MIDI note on drum and pitched tracks, like `Note.fret`. */
  fret: z.int().min(0).max(127),
  speed: z.literal([16, 32, 64]),
});
export type Trill = z.infer<typeof TrillSchema>;

export const NoteSchema = z.object({
  id: IdSchema,
  /** 1 = highest-pitched string, as in Guitar Pro; always 0 on drum and pitched tracks. */
  string: z.int().min(0),
  /** Fret on fretted tracks; the MIDI note on drum and pitched tracks. */
  fret: z.int().min(0).max(127),
  /** Continues the previous note on the same string (same pitch on drum and pitched tracks). */
  tie: z.boolean(),
  dead: z.boolean(),
  ghost: z.boolean(),
  accent: AccentSchema,
  staccato: z.boolean(),
  bend: BendSchema.exactOptional(),
  slide: z.array(SlideKindSchema).exactOptional(),
  /** Hammered on or pulled off from the previous note on the string, not to the next. */
  hammerPull: z.boolean(),
  vibrato: VibratoSchema,
  palmMute: z.boolean(),
  letRing: z.boolean(),
  harmonic: HarmonicSchema.exactOptional(),
  trill: TrillSchema.exactOptional(),
  leftHandFinger: FingerSchema.exactOptional(),
  rightHandFinger: FingerSchema.exactOptional(),
  dynamics: DynamicsSchema,
  /** The letter's alteration (`flat` lowers it), not the printed sign; absent = spell from the key. */
  accidental: AccidentalSchema.exactOptional(),
});
export type Note = z.infer<typeof NoteSchema>;
