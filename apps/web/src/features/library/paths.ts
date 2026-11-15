import type { Id } from '@reprise/model';

// The only place library storage paths are built. They are root-relative, never absolute paths
// from `libraryDir()`: once the platform contract (#202, PR #207) lands, `readFile`, `writeFile`
// and a string `writeHandle` accept the form and create parent folders. Until it does, only an
// adapter that already accepts it can read these.
//
// The spelling is also stored in each song's row (`nativePath`, `originalPath`), so it is part of
// the persisted schema: changing it later takes a new schema version with an `upgrade`, not an
// edit here.

export function nativePathOf(id: Id): string {
  return `library/songs/${id}.reprise`;
}

/** `safeName` is the user's file name made safe for a path (PR 2). */
export function originalPathOf(id: Id, safeName: string): string {
  return `library/originals/${id}/${safeName}`;
}
