import { IdSchema, type Id } from '@reprise/model';
import { z } from 'zod';

// Where the open document's autosave lives. Root-relative under the `data` storage root, so the
// desktop build keeps them in `userData/files/drafts/` and the browser in OPFS `data/drafts/`.

export const DRAFTS_DIR = 'data/drafts';

const NATIVE_EXT = '.reprise';
const SIDECAR_EXT = '.json';

/**
 * A library song's draft is keyed by its song id; any other document (a new song, a file opened
 * without importing, a deleted song's) by its document id.
 */
export function draftKeyOf(songId: Id | undefined, documentId: Id): string {
  return songId ?? `doc-${documentId}`;
}

export function draftNativePath(key: string): string {
  return `${DRAFTS_DIR}/${key}${NATIVE_EXT}`;
}

export function draftSidecarPath(key: string): string {
  return `${DRAFTS_DIR}/${key}${SIDECAR_EXT}`;
}

/** What the recovery dialog needs without reading the score: written after the bytes. */
export const DraftSidecarSchema = z.object({
  version: z.literal(1),
  key: z.string(),
  songId: IdSchema.exactOptional(),
  name: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  /** The document's revision when written: what a later write is newer than. */
  revision: z.number().exactOptional(),
});

export type DraftSidecar = z.infer<typeof DraftSidecarSchema>;

/** The key of a file name in the drafts folder, or undefined for one that is neither half. */
export function draftFileKey(
  fileName: string,
): { key: string; kind: 'native' | 'sidecar' } | undefined {
  if (fileName.endsWith(NATIVE_EXT)) {
    return { key: fileName.slice(0, -NATIVE_EXT.length), kind: 'native' };
  }
  if (fileName.endsWith(SIDECAR_EXT)) {
    return { key: fileName.slice(0, -SIDECAR_EXT.length), kind: 'sidecar' };
  }
  return undefined;
}
