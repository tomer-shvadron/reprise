import { z } from 'zod';

import { FingerSchema } from './note';

export const BarreSchema = z.object({
  fret: z.int().min(1),
  firstString: z.int().min(1),
  lastString: z.int().min(1),
});
export type Barre = z.infer<typeof BarreSchema>;

export const ChordDiagramSchema = z.object({
  /** First fret shown in the grid; `frets` stay absolute. */
  baseFret: z.int().min(1),
  /** One entry per string, string 1 first; `null` is a muted (x) string, 0 an open one. */
  frets: z.array(z.int().min(0).nullable()),
  barres: z.array(BarreSchema).exactOptional(),
  /** Parallel to `frets`; `null` where no finger is shown. */
  fingering: z.array(FingerSchema.nullable()).exactOptional(),
});
export type ChordDiagram = z.infer<typeof ChordDiagramSchema>;

/** A chord name above the beat, with its grid when the file carries one. */
export const ChordSchema = z.object({
  name: z.string(),
  diagram: ChordDiagramSchema.exactOptional(),
});
export type Chord = z.infer<typeof ChordSchema>;
