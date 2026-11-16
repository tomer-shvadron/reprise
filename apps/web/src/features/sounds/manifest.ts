import { IdSchema } from '@reprise/model';
import { z } from 'zod';

export const PACK_FAMILIES = [
  'electric-guitar',
  'acoustic-guitar',
  'bass',
  'drums',
  'keys',
  'orchestral',
  'other',
] as const;

export const PackFamilySchema = z.enum(PACK_FAMILIES);
export type PackFamily = z.infer<typeof PackFamilySchema>;

export const FAMILY_LABELS: Record<PackFamily, string> = {
  'electric-guitar': 'Electric guitar',
  'acoustic-guitar': 'Acoustic guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  orchestral: 'Orchestral',
  other: 'Other',
};

/** A path inside a pack: '/'-separated, relative, no empty, `.` or `..` segment, no NUL. */
export const PackPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.includes('\\') &&
      !path.includes('\0') &&
      path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    { message: 'Expected a relative pack path' },
  );

const httpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://'), { message: 'Expected an https URL' });

/** Where a pack's data lives under `data/sounds/<id>/`; `pack.json` stays out of the pack's own files. */
export const PACK_FILES_DIR = 'files';
export const SOUNDS_DIR = 'data/sounds';

export const InstrumentSchema = z.object({
  /** What a track's `sound.instrument` names. Lower-case letters, digits and dashes. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(120),
  gmPrograms: z.array(z.number().int().min(0).max(127)).exactOptional(),
  /** SFZ paths in the pack by articulation-set key; `default` is required to play. */
  entries: z
    .record(z.string().min(1).max(64), PackPathSchema)
    .refine((entries) => Object.hasOwn(entries, 'default'), { message: 'entries needs a default' }),
});
export type PackInstrument = z.infer<typeof InstrumentSchema>;

export const DownloadSchema = z.object({
  url: httpsUrl,
  /** Of the archive, lower-case hex. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Of the archive: the size the download is capped at (with a margin) and shown. */
  sizeBytes: z.number().int().positive(),
  /** The folder inside the archive that holds the pack, when it is not the only top-level folder. */
  root: z.string().min(1).exactOptional(),
});
export type PackDownload = z.infer<typeof DownloadSchema>;

export const PackManifestSchema = z
  .object({
    schema: z.literal(1),
    /** Twelve letters or digits: what `Track.sound.packId` holds. Fixed for a curated pack. */
    id: IdSchema,
    name: z.string().min(1).max(120),
    family: PackFamilySchema,
    /** General MIDI programs the pack can stand in for; a drum pack lists none. */
    gmPrograms: z.array(z.number().int().min(0).max(127)),
    format: z.literal('sfz'),
    /**
     * A curated pack's version bumps when its url or hash change ("update available"). A copy of
     * the listed version takes the list's instruments and entries on every scan, with no bump.
     */
    version: z.string().min(1).max(40),
    /** Absent for a custom pack, which has no list entry; the curated list's test requires all three. */
    sourceUrl: httpsUrl.exactOptional(),
    licenseName: z.string().min(1).max(120).exactOptional(),
    licenseUrl: httpsUrl.exactOptional(),
    directDownload: z.boolean(),
    download: DownloadSchema.exactOptional(),
    /** Installed size, shown before downloading. */
    sizeBytes: z.number().int().positive().exactOptional(),
    instruments: z.array(InstrumentSchema).min(1),
  })
  .refine((pack) => !pack.directDownload || pack.download !== undefined, {
    message: 'directDownload needs a download with a sha256 and size',
  });
export type PackManifest = z.infer<typeof PackManifestSchema>;

export const PACK_SOURCES = ['download', 'zip', 'folder'] as const;

/** A manifest as written to `pack.json`, plus what the install added. */
export const InstalledPackSchema = z
  .object({
    curated: z.boolean(),
    source: z.enum(PACK_SOURCES),
    installedAt: z.iso.datetime(),
    /**
     * Pack-relative '/' path and byte size of every file under `files/`. Pairs, not a record, so a
     * file named `__proto__` is data. It is the size estimate and the case-insensitive index.
     */
    files: z.array(z.tuple([PackPathSchema, z.number().int().nonnegative()])),
  })
  .and(PackManifestSchema);
export type InstalledPack = z.infer<typeof InstalledPackSchema>;

export const packFolder = (id: string) => `${SOUNDS_DIR}/${id}`;
export const packFilePath = (id: string, path: string) =>
  `${SOUNDS_DIR}/${id}/${PACK_FILES_DIR}/${path}`;

/** Reads `pack.json` text; undefined when it is not a pack of this version. */
export function parseInstalledPack(text: string): InstalledPack | undefined {
  try {
    const parsed = InstalledPackSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
