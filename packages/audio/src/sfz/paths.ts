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

/** `%2e`, `%2f`, `%5c` and `%00` in any case: a reader that builds a URL would decode them. */
const ENCODED = /%(2e|2f|5c|00)/i;
/** Windows device names, which block or alias a device when read, with or without an extension. */
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function hasControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** True for a segment no reader should be handed. */
function unsafe(segment: string): boolean {
  return hasControl(segment) || ENCODED.test(segment) || DEVICE.test(segment.trimEnd());
}

/**
 * Joins the parts against `base` and resolves `.` and `..`. `undefined` when the result would
 * leave the pack root, when a part is absolute (a leading slash or a drive letter), or when a
 * segment is percent-encoded, holds a control character or names a Windows device.
 */
export function resolvePath(base: string, ...parts: string[]): string | undefined {
  const segments = base === '' ? [] : base.split('/');
  for (const raw of parts) {
    const part = raw.replaceAll('\\', '/');
    if (part.startsWith('/') || /^[A-Za-z]:/.test(part)) return undefined;
    for (const segment of part.split('/')) {
      if (unsafe(segment)) return undefined;
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
