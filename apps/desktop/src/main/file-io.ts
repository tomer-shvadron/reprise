import { readFile, writeFile } from 'node:fs/promises';

import type { ReadRange } from '@reprise/web';

import type { PathAccess } from './path-access';
import { readFileIn, readRangeOf, writeFileIn, type StorageRoots } from './storage-fs';
import { isStoragePath } from './storage-path';

/**
 * `file:read` and `file:write` take two spellings. A path starting with a root name
 * (`library/songs/a.reprise`) is the app's own file, resolved and checked by `storage-fs`; any
 * other path is absolute and must be one the user picked or saved through a dialog, or lie
 * under a root. An absolute path cannot start with a root name, so the two never collide.
 * Reading accepts read-only grants (a picked file); writing does not.
 */
export async function readPath(
  path: string,
  access: PathAccess,
  roots: StorageRoots,
  range?: ReadRange,
): Promise<Uint8Array> {
  if (isStoragePath(path)) return readFileIn(roots, path, range);
  if (!access.allowsRead(path)) throw new Error(`Read access to ${path} was not granted`);
  return range ? readRangeOf(path, range) : readFile(path);
}

export async function writePath(
  path: string,
  bytes: Uint8Array,
  access: PathAccess,
  roots: StorageRoots,
): Promise<void> {
  if (isStoragePath(path)) {
    await writeFileIn(roots, path, bytes);
    return;
  }
  if (!access.allows(path)) throw new Error(`Write access to ${path} was not granted`);
  await writeFile(path, bytes);
}
