import type { Id } from '@reprise/model';

// The only place library storage paths are built, so a change to the platform's path spelling
// (#202) adapts here. They are root-relative, never absolute paths from `libraryDir()`: the
// platform resolves them, and `readFile`, `writeFile` and a string `writeHandle` accept the form.

export function nativePathOf(id: Id): string {
  return `library/songs/${id}.reprise`;
}

/** `safeName` is the user's file name made safe for a path (PR 2). */
export function originalPathOf(id: Id, safeName: string): string {
  return `library/originals/${id}/${safeName}`;
}
