import { randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

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
      // A write in flight, or one a crash left behind, is not a file of the app's.
      if (TEMP_NAME.test(entry.name)) return [];
      // Symlinks and special files are not ours to list: the other calls refuse to follow them.
      if (entry.isFile()) return [{ name: entry.name, kind: 'file' }];
      if (entry.isDirectory()) return [{ name: entry.name, kind: 'directory' }];
      return [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The three fs calls `moveIn` uses, so a test can make `rename` fail the way a second volume does. */
export interface MoveOps {
  rename: typeof rename;
  cp: typeof cp;
  rm: typeof rm;
}

const realMoveOps: MoveOps = { rename, cp, rm };

export async function moveIn(
  roots: StorageRoots,
  from: unknown,
  to: unknown,
  ops: MoveOps = realMoveOps,
): Promise<void> {
  const source = await resolveSafe(roots, from, { allowRoot: false });
  const target = await resolveSafe(roots, to, { allowRoot: false });
  if (!(await exists(source))) throw new Error(`Nothing to move at "${String(from)}"`);
  if (target === source || target.startsWith(source + sep)) {
    throw new Error(`Cannot move "${String(from)}" into itself`);
  }
  if (await exists(target)) throw new Error(`"${String(to)}" already exists`);
  await mkdir(dirname(target), { recursive: true });
  try {
    await ops.rename(source, target);
  } catch (error) {
    if (codeOf(error) !== 'EXDEV') throw error;
    // The roots can sit on different volumes, where rename is refused. `force: false` is what
    // makes `errorOnExist` bite, so a target that appeared since the check is never merged into.
    try {
      await ops.cp(source, target, {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      });
    } catch (copyError) {
      // A partial target would block every retry with "already exists"; the source is intact.
      // Not when the target already existed: that one is not ours to delete.
      if (codeOf(copyError) !== 'ERR_FS_CP_EEXIST') {
        await ops.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
      throw copyError;
    }
    // If this fails both copies exist and the call rejects: nothing is lost, and the caller's
    // cleanup finds a rejected move whose target exists.
    await ops.rm(source, { recursive: true });
  }
}

export async function removeIn(roots: StorageRoots, path: unknown): Promise<void> {
  await rm(await resolveSafe(roots, path, { allowRoot: false }), { recursive: true, force: true });
}

/** The bytes of a file under a root; never follows a symlink, and a root is not a file. */
export async function readFileIn(roots: StorageRoots, path: unknown): Promise<Uint8Array> {
  return readFile(await resolveSafe(roots, path, { allowRoot: false }));
}

/** `.name.<12 hex>.tmp`, the sibling a write goes through before it replaces its target. */
const TEMP_NAME = /^\..+\.[0-9a-f]{12}\.tmp$/;

/** The fs calls `writeFileIn` makes, so a test can make one of them fail. */
export interface WriteOps {
  open: typeof open;
  rename: typeof rename;
  rm: typeof rm;
}

const realWriteOps: WriteOps = { open, rename, rm };

/**
 * Writes a file under a root, making the folders above it, as the browser and the test double do.
 * The bytes go to a temp file in the same folder, are flushed to disk, and replace the target in
 * one `rename`, so a kill mid-write leaves the old file whole, never half of the new one.
 */
export async function writeFileIn(
  roots: StorageRoots,
  path: unknown,
  bytes: Uint8Array,
  ops: WriteOps = realWriteOps,
): Promise<void> {
  const target = await resolveSafe(roots, path, { allowRoot: false });
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    // `wx` never reuses a name, so two writes of one file cannot share a temp file.
    const file = await ops.open(temp, 'wx');
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await ops.rename(temp, target);
  } catch (error) {
    await ops.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
