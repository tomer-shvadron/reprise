import type { DirEntry, Platform } from '@/platform/platform';
import { parseStoragePath } from '@/platform/storage-path';

export type MemoryStorageCalls = Pick<
  Platform,
  'mkdir' | 'listDir' | 'move' | 'remove' | 'readFile' | 'writeFile' | 'libraryDir' | 'dataDir'
>;

export interface MemoryStorage {
  /** The platform members the storage backs; spread them into `fakePlatform({ ...storage.calls })`. */
  calls: MemoryStorageCalls;
  /** Every file and directory held, as storage paths (`library/songs/a.reprise`), sorted. */
  paths(): string[];
  /** The bytes of a file by storage path, or undefined. */
  bytes(path: string): Uint8Array | undefined;
}

/** What the double returns for `libraryDir()` and `dataDir()`, as the browser's adapter does. */
export const MEMORY_LIBRARY_DIR = '/library';
export const MEMORY_DATA_DIR = '/data';

/**
 * An in-memory stand-in for the platform's file operations, with the contract's rules: paths
 * start with `library` or `data`, `..` and absolute paths are rejected, `mkdir` is recursive,
 * `move` makes the target's parent and refuses an existing target. `readFile` and `writeFile`
 * take the absolute paths `libraryDir()` and `dataDir()` hand out, so lanes can exercise both
 * spellings against one store.
 */
export function createMemoryStorage(): MemoryStorage {
  // A directory is `undefined`, a file its bytes. The two roots always exist.
  const entries = new Map<string, Uint8Array | undefined>([
    ['library', undefined],
    ['data', undefined],
  ]);

  const keyOf = (path: string) => {
    const { root, segments } = parseStoragePath(path);
    return [root, ...segments].join('/');
  };
  const parentOf = (key: string) => key.slice(0, key.lastIndexOf('/'));
  const nameOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);
  const isDirectory = (key: string) => entries.has(key) && entries.get(key) === undefined;

  function makeDirs(key: string): void {
    const existing = entries.get(key);
    if (entries.has(key)) {
      if (existing !== undefined) throw new Error(`"${key}" is a file`);
      return;
    }
    makeDirs(parentOf(key));
    entries.set(key, undefined);
  }

  const under = (key: string) => [...entries.keys()].filter((k) => k.startsWith(`${key}/`));

  const absoluteToStorage = (path: string) => {
    for (const [prefix, root] of [
      [MEMORY_LIBRARY_DIR, 'library'],
      [MEMORY_DATA_DIR, 'data'],
    ] as const) {
      if (path === prefix || path.startsWith(`${prefix}/`))
        return keyOf(`${root}${path.slice(prefix.length)}`);
    }
    throw new Error(`Not inside the library or data directory: "${path}"`);
  };

  // A bad path rejects like the real calls do, instead of throwing before a promise exists.
  const reply = <T>(run: () => T): Promise<T> => {
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const calls: MemoryStorageCalls = {
    mkdir: (path) =>
      reply(() => {
        makeDirs(keyOf(path));
      }),
    listDir: (path) =>
      reply((): DirEntry[] => {
        const key = keyOf(path);
        return [...entries.keys()]
          .filter((k) => k !== key && parentOf(k) === key)
          .sort()
          .map((k) => ({ name: nameOf(k), kind: isDirectory(k) ? 'directory' : 'file' }));
      }),
    move: (from, to) =>
      reply(() => {
        const source = keyOf(from);
        const target = keyOf(to);
        if (!entries.has(source) || !source.includes('/')) {
          throw new Error(`Nothing to move at "${from}"`);
        }
        if (entries.has(target)) throw new Error(`"${to}" already exists`);
        if (target.startsWith(`${source}/`)) throw new Error(`Cannot move "${from}" into itself`);
        makeDirs(parentOf(target));
        for (const key of [source, ...under(source)]) {
          const bytes = entries.get(key);
          entries.delete(key);
          entries.set(target + key.slice(source.length), bytes);
        }
      }),
    remove: (path) =>
      reply(() => {
        const key = keyOf(path);
        if (!key.includes('/')) throw new Error(`"${key}" is a root`);
        for (const k of [key, ...under(key)]) entries.delete(k);
      }),
    readFile: (path) =>
      reply(() => {
        const bytes = entries.get(absoluteToStorage(path));
        if (!bytes) throw new Error(`No file at ${path}`);
        return bytes.slice();
      }),
    writeFile: (path, bytes) =>
      reply(() => {
        const key = absoluteToStorage(path);
        if (isDirectory(key)) throw new Error(`"${path}" is a directory`);
        makeDirs(parentOf(key));
        entries.set(key, bytes.slice());
      }),
    libraryDir: () => Promise.resolve(MEMORY_LIBRARY_DIR),
    dataDir: () => Promise.resolve(MEMORY_DATA_DIR),
  };

  return {
    calls,
    paths: () => [...entries.keys()].filter((k) => k.includes('/')).sort(),
    bytes: (path) => entries.get(keyOf(path)),
  };
}
