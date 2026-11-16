import type { Id } from '@reprise/model';

// The only place library storage paths are built. They are root-relative, never absolute paths
// from `libraryDir()`: `readFile`, `writeFile` and a string `writeHandle` accept the form and
// create parent folders (the platform contract, #202).
//
// The spelling is also stored in each song's row (`nativePath`, `originalPath`), so it is part of
// the persisted schema: changing it later takes a new schema version with an `upgrade`, not an
// edit here.

export function nativePathOf(id: Id): string {
  return `library/songs/${id}.reprise`;
}

/** `safeName` is the user's file name made safe for a path (`import/safe-name.ts`). */
export function originalPathOf(id: Id, safeName: string): string {
  return `library/originals/${id}/${safeName}`;
}

export function originalsDirOf(id: Id): string {
  return `library/originals/${id}`;
}

/** Where deleted songs go, one folder per song, so a restore by hand stays possible. */
export const TRASH_DIR = 'library/trash';

export function trashDirOf(name: string): string {
  return `${TRASH_DIR}/${name}`;
}

/** What every library path starts with; a save handle under it points at a library song. */
export const LIBRARY_PREFIX = 'library/';
