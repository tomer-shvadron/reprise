import { STORAGE_ROOTS, type StorageRoot } from './bridge';

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

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
 * rules, so a path one platform refuses the other refuses too. Text only, never the storage.
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
      segment.includes(':') ||
      segment.length > MAX_SEGMENT_LENGTH
    ) {
      throw new Error(`Not a valid storage path segment: "${segment}"`);
    }
  }
  return { root, segments };
}
