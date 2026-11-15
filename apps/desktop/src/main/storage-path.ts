import type { StorageRoot } from '@reprise/web';

// A type-only import is all desktop may take from web, so the value list is repeated here;
// the satisfies clause makes a root added to the contract fail typecheck until this follows.
export const STORAGE_ROOTS = ['library', 'data'] as const satisfies readonly StorageRoot[];

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
const WINDOWS_FORBIDDEN = /[<>"|?*:]/;

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

/**
 * Names Windows tools cannot open or delete, refused on every platform so a library means the
 * same everywhere: a trailing dot or space (Win32 trims it, so `a.` and `a` would collide), a
 * device name with or without an extension, `<>"|?*` and control characters. `:` is among them,
 * which also shuts out NTFS alternate data streams.
 */
function isWindowsHostile(segment: string): boolean {
  return (
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    RESERVED_DEVICE_NAME.test(segment) ||
    WINDOWS_FORBIDDEN.test(segment) ||
    hasControlCharacter(segment)
  );
}

/** Thrown when a renderer-supplied storage path is not a plain relative path under a root. */
export class StoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

export interface StoragePath {
  root: StorageRoot;
  /** The names below the root; empty for the root itself. */
  segments: string[];
}

function isRoot(value: string): value is StorageRoot {
  return STORAGE_ROOTS.some((root) => root === value);
}

/**
 * Keep the case table in storage-path.test.ts in step with the browser twin's
 * (apps/web/src/platform/storage-path.ts); the apps share no code.
 *
 * Checks the text only, never the disk: `library/songs/a.reprise`, with the root named first.
 * Absolute paths, drive letters, backslashes, `..`, `.`, empty segments and Windows-hostile names
 * are all refused, so no accepted path can name anything outside a root.
 */
export function parseStoragePath(value: unknown): StoragePath {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new StoragePathError('Expected a storage path');
  }
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')) {
    throw new StoragePathError(`Not a relative storage path: "${value}"`);
  }
  const [root, ...segments] = value.split('/');
  if (root === undefined || !isRoot(root)) {
    throw new StoragePathError(`A storage path starts with ${STORAGE_ROOTS.join(' or ')}`);
  }
  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.length > MAX_SEGMENT_LENGTH ||
      isWindowsHostile(segment)
    ) {
      throw new StoragePathError(`Not a valid storage path segment: "${segment}"`);
    }
  }
  return { root, segments };
}

/** True for a path that names a storage root, as opposed to an absolute picked or saved path. */
export function isStoragePath(value: string): boolean {
  return /^(library|data)(\/|$)/.test(value);
}
