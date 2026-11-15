import type { DirEntry } from './bridge';
import { parseStoragePath } from './storage-path';

function errorName(error: unknown): string | undefined {
  return error instanceof DOMException ? error.name : undefined;
}

/** The kind of the entry `name` in `dir`, or undefined when there is none. */
async function entryKind(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<'file' | 'directory' | undefined> {
  try {
    await dir.getFileHandle(name);
    return 'file';
  } catch (error) {
    // A name that is a directory refuses to be opened as a file.
    if (errorName(error) === 'TypeMismatchError') return 'directory';
    if (errorName(error) === 'NotFoundError') return undefined;
    throw error;
  }
}

async function handleOf(
  dir: FileSystemDirectoryHandle,
  name: string,
  kind: 'file' | 'directory',
): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
  return kind === 'file' ? dir.getFileHandle(name) : dir.getDirectoryHandle(name);
}

async function copyEntry(
  source: FileSystemFileHandle | FileSystemDirectoryHandle,
  into: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  if (source.kind === 'file') {
    const bytes = await (await source.getFile()).arrayBuffer();
    const writable = await (await into.getFileHandle(name, { create: true })).createWritable();
    await writable.write(bytes);
    await writable.close();
    return;
  }
  const copy = await into.getDirectoryHandle(name, { create: true });
  for await (const [childName, child] of source.entries()) await copyEntry(child, copy, childName);
}

export interface OpfsStorage {
  mkdir(path: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * `Platform`'s storage calls over origin-private storage: the root named by a path's first
 * segment is a directory of that name at the top of the origin-private file system, which is
 * also what `libraryDir()` and `dataDir()` return in the browser. OPFS has no symlinks, and
 * `parseStoragePath` refuses `..`, so a path cannot leave its root.
 */
export function createOpfsStorage(getRoot: () => Promise<FileSystemDirectoryHandle>): OpfsStorage {
  async function walkTo(
    names: readonly string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | undefined> {
    let dir = await getRoot();
    for (const name of names) {
      try {
        dir = await dir.getDirectoryHandle(name, { create });
      } catch (error) {
        if (!create && errorName(error) === 'NotFoundError') return undefined;
        throw error;
      }
    }
    return dir;
  }

  /** The entry's parent directory and name; a root itself is not an entry. */
  function entryPath(path: string): { names: string[]; name: string } {
    const { root, segments } = parseStoragePath(path);
    const name = segments.pop();
    if (name === undefined) throw new Error(`"${root}" is a root, not a path inside one`);
    return { names: [root, ...segments], name };
  }

  return {
    async mkdir(path) {
      const { root, segments } = parseStoragePath(path);
      await walkTo([root, ...segments], true);
    },

    async listDir(path) {
      const { root, segments } = parseStoragePath(path);
      const dir = await walkTo([root, ...segments], false);
      if (!dir) return [];
      const entries: DirEntry[] = [];
      for await (const [name, handle] of dir.entries()) entries.push({ name, kind: handle.kind });
      return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },

    async move(from, to) {
      const source = entryPath(from);
      const target = entryPath(to);
      const fromKey = [...source.names, source.name].join('/');
      const toKey = [...target.names, target.name].join('/');
      if (toKey === fromKey || toKey.startsWith(`${fromKey}/`)) {
        throw new Error(`Cannot move "${from}" into itself`);
      }
      const sourceDir = await walkTo(source.names, false);
      const kind = sourceDir && (await entryKind(sourceDir, source.name));
      if (!sourceDir || !kind) throw new Error(`Nothing to move at "${from}"`);
      const targetDir = await walkTo(target.names, true);
      if (!targetDir) throw new Error(`Could not create the parent of "${to}"`);
      if (await entryKind(targetDir, target.name)) throw new Error(`"${to}" already exists`);

      const handle = await handleOf(sourceDir, source.name, kind);
      if (typeof handle.move === 'function') {
        try {
          await handle.move(targetDir, target.name);
          return;
        } catch {
          // Engines differ on what `move` accepts (directories, other parents); copying always works.
        }
      }
      await copyEntry(handle, targetDir, target.name);
      await sourceDir.removeEntry(source.name, { recursive: true });
    },

    async remove(path) {
      const { names, name } = entryPath(path);
      const dir = await walkTo(names, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch (error) {
        if (errorName(error) !== 'NotFoundError') throw error;
      }
    },
  };
}
