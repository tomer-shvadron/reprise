import { STORAGE_ROOTS, type StorageRoot } from './bridge';

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const WINDOWS_FORBIDDEN = /[<>"|?*:]/;

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

/** Names Windows tools cannot open or delete, refused everywhere; see the desktop twin. */
function isWindowsHostile(segment: string): boolean {
  return (
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    RESERVED_DEVICE_NAME.test(segment) ||
    WINDOWS_FORBIDDEN.test(segment) ||
    hasControlCharacter(segment)
  );
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
 * The browser's twin of desktop main's `parseStoragePath` (the two apps share no code): the same
 * rules, so a path one platform refuses the other refuses too. Keep the case table in
 * apps/desktop/src/main/storage-path.test.ts in step with browser-storage.test.ts. Text only, never the storage.
 */
export function parseStoragePath(value: string): StoragePath {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw new Error('Expected a storage path');
  }
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')) {
    throw new Error(`Not a relative storage path: "${value}"`);
  }
  const [root, ...segments] = value.split('/');
  if (root === undefined || !isRoot(root)) {
    throw new Error(`A storage path starts with ${STORAGE_ROOTS.join(' or ')}`);
  }
  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.length > MAX_SEGMENT_LENGTH ||
      isWindowsHostile(segment)
    ) {
      throw new Error(`Not a valid storage path segment: "${segment}"`);
    }
  }
  return { root, segments };
}

/** True for a path that names a storage root, as opposed to an absolute picked or saved path. */
export function isStoragePath(value: string): boolean {
  return /^(library|data)(\/|$)/.test(value);
}
