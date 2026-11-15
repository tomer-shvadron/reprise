import { cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import type { DirEntry, StorageRoot } from '@reprise/web';

import { parseStoragePath, StoragePathError } from './storage-path';

export type StorageRoots = Readonly<Record<StorageRoot, string>>;

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
}

/**
 * The absolute path of a storage path, after checking each component that exists below the root
 * is not a symlink. The text is checked by `parseStoragePath`; this adds what only the disk can
 * tell. The window between this check and the operation is accepted, as in `PathAccess`.
 */
async function resolveSafe(
  roots: StorageRoots,
  value: unknown,
  { allowRoot }: { allowRoot: boolean },
): Promise<string> {
  const { root, segments } = parseStoragePath(value);
  if (!allowRoot && segments.length === 0) {
    throw new StoragePathError(`"${root}" is a root, not a path inside one`);
  }
  let current = roots[root];
  for (const segment of segments) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new StoragePathError(`Refusing to follow a symlink at "${String(value)}"`);
      }
    } catch (error) {
      if (codeOf(error) === 'ENOENT') break;
      throw error;
    }
  }
  return join(roots[root], ...segments);
}

export async function mkdirIn(roots: StorageRoots, path: unknown): Promise<void> {
  await mkdir(await resolveSafe(roots, path, { allowRoot: true }), { recursive: true });
}

export async function listDirIn(roots: StorageRoots, path: unknown): Promise<DirEntry[]> {
  const dir = await resolveSafe(roots, path, { allowRoot: true });
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .flatMap((entry): DirEntry[] => {
      // Symlinks and special files are not ours to list: the other calls refuse to follow them.
      if (entry.isFile()) return [{ name: entry.name, kind: 'file' }];
      if (entry.isDirectory()) return [{ name: entry.name, kind: 'directory' }];
      return [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function moveIn(roots: StorageRoots, from: unknown, to: unknown): Promise<void> {
  const source = await resolveSafe(roots, from, { allowRoot: false });
  const target = await resolveSafe(roots, to, { allowRoot: false });
  if (!(await exists(source))) throw new Error(`Nothing to move at "${String(from)}"`);
  if (target === source || target.startsWith(source + sep)) {
    throw new Error(`Cannot move "${String(from)}" into itself`);
  }
  if (await exists(target)) throw new Error(`"${String(to)}" already exists`);
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    if (codeOf(error) !== 'EXDEV') throw error;
    // The roots can sit on different volumes, where rename is refused.
    await cp(source, target, { recursive: true, errorOnExist: true, verbatimSymlinks: true });
    await rm(source, { recursive: true });
  }
}

export async function removeIn(roots: StorageRoots, path: unknown): Promise<void> {
  await rm(await resolveSafe(roots, path, { allowRoot: false }), { recursive: true, force: true });
}
