import { z } from 'zod';

import { IdSchema } from './id';
import { MasterBarSchema } from './master-bar';
import { TrackSchema } from './track';

export const SCORE_VERSION = 1;

export const ScoreMetaSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  artist: z.string(),
  album: z.string(),
  /** Lyricist. */
  words: z.string(),
  /** Composer. */
  music: z.string(),
  copyright: z.string(),
  /** Who transcribed the tab. */
  tab: z.string(),
  instructions: z.string(),
  notices: z.array(z.string()),
});
export type ScoreMeta = z.infer<typeof ScoreMetaSchema>;

export const ScoreSchema = z.object({
  id: IdSchema,
  /** The native schema version this object conforms to. */
  version: z.literal(SCORE_VERSION),
  meta: ScoreMetaSchema,
  /** One per bar position, shared by every track. */
  masterBars: z.array(MasterBarSchema).min(1),
  tracks: z.array(TrackSchema).min(1),
});
export type Score = z.infer<typeof ScoreSchema>;
