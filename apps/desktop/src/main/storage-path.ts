import type { StorageRoot } from '@reprise/web';

// A type-only import is all desktop may take from web, so the value list is repeated here;
// the satisfies clause makes a root added to the contract fail typecheck until this follows.
export const STORAGE_ROOTS = ['library', 'data'] as const satisfies readonly StorageRoot[];

const MAX_PATH_LENGTH = 1024;
const MAX_SEGMENT_LENGTH = 255;

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
 * Checks the text only, never the disk: `library/songs/a.reprise`, with the root named first.
 * Absolute paths, drive letters, backslashes, `..`, `.`, empty segments and `:` (a Windows
 * alternate data stream) are all refused, so no accepted path can name anything outside a root.
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
      segment.includes(':') ||
      segment.length > MAX_SEGMENT_LENGTH
    ) {
      throw new StoragePathError(`Not a valid storage path segment: "${segment}"`);
    }
  }
  return { root, segments };
}
