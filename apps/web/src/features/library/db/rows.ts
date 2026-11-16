import type { Format } from '@reprise/formats';
import { IdSchema } from '@reprise/model';
import { z } from 'zod';

import type { TrackSession } from '@/features/tracks';

const FormatSchema = z.enum([
  'gp3',
  'gp4',
  'gp5',
  'gp',
  'gpx',
  'reprise',
]) satisfies z.ZodType<Format>;

/** Declared here and checked against the interface, so it follows `features/tracks/session.ts`. */
export const TrackSessionSchema = z.object({
  version: z.literal(1),
  view: z.object({
    tracks: z.union([z.literal('all'), z.array(IdSchema)]),
    only: IdSchema.exactOptional(),
  }),
  mixer: z.record(
    IdSchema,
    z.object({ mute: z.boolean().exactOptional(), solo: z.boolean().exactOptional() }),
  ),
  currentTrack: IdSchema.exactOptional(),
}) satisfies z.ZodType<TrackSession>;

export const SongRowSchema = z.object({
  /** The library song id that `document.songId` and the practice log attach to. */
  id: IdSchema,
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  sourceFormat: FormatSchema,
  /**
   * Root-relative (`library/songs/<id>.reprise`), built in `paths.ts`; also the document's save
   * handle. The spelling is persisted, so it is part of the schema (changing it needs an upgrade).
   */
  nativePath: z.string(),
  /**
   * Root-relative (`library/originals/<id>/<name>`), built in `paths.ts`; persisted like
   * `nativePath`. Absent for a song that began in Reprise (a new song's first Save): there is no
   * original file.
   */
  originalPath: z.string().exactOptional(),
  originalName: z.string(),
  /** SHA-256 hex of the imported bytes; a unique index, so a duplicate import is skipped. */
  originalKey: z.string(),
  importedAt: z.number(),
  /** Left out until the song is first opened, which keeps it out of the recents index. */
  lastOpenedAt: z.number().exactOptional(),
  bars: z.number().int().nonnegative(),
  tracks: z.array(z.object({ name: z.string() })),
  session: TrackSessionSchema.exactOptional(),
  /** When the native was last written by a Save; absent until then. Drafts compare against it. */
  savedAt: z.number().exactOptional(),
  /**
   * The Guitar Pro export warnings (`Warning.code`) the user chose not to be asked about again for
   * this song. Not indexed, so it needs no schema version. Travels with the row to the trash.
   */
  exportAcknowledged: z.array(z.string()).exactOptional(),
});
export type SongRow = z.infer<typeof SongRowSchema>;

export const SettingRowSchema = z.object({ key: z.string(), value: z.unknown() });
export type SettingRow = z.infer<typeof SettingRowSchema>;
