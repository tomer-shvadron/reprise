import { formatOfExtension } from '@reprise/formats';

import { PICKED_FOLDER_LIMITS, type PickedFile } from '@/platform/platform';

/** A file to import, read on demand so a folder of hundreds stays cheap. */
export interface ImportSource {
  /** What the user sees in the summary: the path inside a picked folder, else the file's name. */
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export function fromPicked(file: PickedFile): ImportSource {
  return { name: file.relativePath, size: file.size, read: () => file.read() };
}

export function fromFile(file: File, name: string = file.name): ImportSource {
  return {
    name,
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * What a drop held, taken synchronously: a `DataTransfer` is emptied once the event handler
 * returns, so `webkitGetAsEntry` and `getAsFile` have to be called before the first await.
 */
export interface DropSnapshot {
  files: File[];
  directories: FileSystemDirectoryEntry[];
}

export function snapshotDrop(transfer: DataTransfer): DropSnapshot {
  const snapshot: DropSnapshot = { files: [], directories: [] };
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  if (items.length === 0) {
    snapshot.files.push(...transfer.files);
    return snapshot;
  }
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry && isDirectoryEntry(entry)) {
      snapshot.directories.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) snapshot.files.push(file);
  }
  return snapshot;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

export interface DropWalk {
  sources: ImportSource[];
  /** The walk stopped at the same caps a picked folder has. */
  truncated: boolean;
  /** Folders or files the browser would not let the walk read. */
  skipped: number;
}

/**
 * The dropped files and everything below the dropped folders, in the picked folder's terms:
 * dot entries are skipped and the walk stops at `PICKED_FOLDER_LIMITS`.
 */
export async function resolveDrop(snapshot: DropSnapshot): Promise<DropWalk> {
  const walk: DropWalk = {
    sources: snapshot.files.map((file) => fromFile(file)),
    truncated: false,
    skipped: 0,
  };
  let entries = 0;
  // Only the file and entry caps end the walk; a folder cut by depth leaves its siblings listed.
  let full = false;

  const visit = async (directory: FileSystemDirectoryEntry, prefix: string, depth: number) => {
    const reader = directory.createReader();
    while (!full) {
      let batch: FileSystemEntry[];
      try {
        batch = await readBatch(reader);
      } catch {
        walk.skipped += 1;
        return;
      }
      if (batch.length === 0) return;
      for (const entry of batch) {
        entries += 1;
        if (entries > PICKED_FOLDER_LIMITS.maxEntries) {
          walk.truncated = true;
          full = true;
          return;
        }
        if (entry.name.startsWith('.')) continue;
        const path = `${prefix}/${entry.name}`;
        if (isDirectoryEntry(entry)) {
          if (depth >= PICKED_FOLDER_LIMITS.maxDepth) walk.truncated = true;
          else await visit(entry, path, depth + 1);
        } else if (isFileEntry(entry) && formatOfExtension(entry.name) !== undefined) {
          // Only score files count toward the cap, and only they are fetched.
          if (walk.sources.length >= PICKED_FOLDER_LIMITS.maxFiles) {
            walk.truncated = true;
            full = true;
          } else {
            try {
              walk.sources.push(fromFile(await fileOf(entry), path));
            } catch {
              walk.skipped += 1;
            }
          }
        }
        if (full) return;
      }
    }
  };

  for (const directory of snapshot.directories) await visit(directory, directory.name, 0);
  return walk;
}
