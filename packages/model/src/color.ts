import { z } from 'zod';

/** `#rrggbb`, lower case so serialised scores diff cleanly. */
export const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export type Color = z.infer<typeof ColorSchema>;
