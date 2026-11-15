/**
 * Pack paths: '/'-separated, relative to the pack root, never leaving it. SFZ files written on
 * Windows use backslashes, and pack files are untrusted, so a path is normalized here and refused
 * when it climbs above the root or is absolute.
 */

/** The directory of a normalized path, '' for the root. */
export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Joins the parts against `base` and resolves `.` and `..`. `undefined` when the result would
 * leave the pack root, or when a part is absolute (a leading slash or a drive letter).
 */
export function resolvePath(base: string, ...parts: string[]): string | undefined {
  const segments = base === '' ? [] : base.split('/');
  for (const raw of parts) {
    const part = raw.replaceAll('\\', '/');
    if (part.startsWith('/') || /^[A-Za-z]:/.test(part)) return undefined;
    for (const segment of part.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        if (segments.length === 0) return undefined;
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
  }
  return segments.join('/');
}
