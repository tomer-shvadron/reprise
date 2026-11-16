import { PICKED_FOLDER_LIMITS, type PickedFile, type PickedFolder } from '@/platform/platform';

import type { ZipFile } from './pack-store';

/** The files a pack install copies, as the folder picker's filter lists them. */
export const PACK_EXTENSIONS = [
  'sfz',
  'sfzh',
  'inc',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'txt',
  'md',
];

const wanted = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && PACK_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};

/**
 * What a drop on the Sounds screen held, taken synchronously (a `DataTransfer` is emptied once the
 * handler returns). Folders are kept as entries to walk later.
 */
export interface PackDrop {
  files: File[];
  directories: FileSystemDirectoryEntry[];
}

export function snapshotPackDrop(transfer: DataTransfer): PackDrop {
  const drop: PackDrop = { files: [], directories: [] };
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  if (items.length === 0) {
    drop.files.push(...transfer.files);
    return drop;
  }
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry && isDirectoryEntry(entry)) {
      drop.directories.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) drop.files.push(file);
  }
  return drop;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

/** A dropped or picked `File` as the zip reader's source: ranges are sliced, never the whole file. */
export function zipFileOf(file: File): ZipFile {
  return {
    name: file.name,
    size: file.size,
    read: ({ offset, length }) => bytesOf(file.slice(offset, offset + length)),
  };
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });

/**
 * A dropped folder as a picked one: every file below it, dot entries skipped, stopped at the same
 * caps a picked folder has. Only the walk is done here; contents are read when the installer asks.
 */
export async function walkDroppedFolder(root: FileSystemDirectoryEntry): Promise<PickedFolder> {
  const folder: PickedFolder = { name: root.name, files: [], truncated: false, skipped: 0 };
  let entries = 0;

  const visit = async (directory: FileSystemDirectoryEntry, prefix: string, depth: number) => {
    const reader = directory.createReader();
    for (;;) {
      let batch: FileSystemEntry[];
      try {
        batch = await readBatch(reader);
      } catch {
        folder.skipped += 1;
        return;
      }
      if (batch.length === 0) return;
      for (const entry of batch) {
        entries += 1;
        if (entries > PICKED_FOLDER_LIMITS.maxEntries) {
          folder.truncated = true;
          return;
        }
        if (entry.name.startsWith('.')) continue;
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (isDirectoryEntry(entry)) {
          if (depth >= PICKED_FOLDER_LIMITS.maxDepth) folder.truncated = true;
          else await visit(entry, path, depth + 1);
        } else if (!isFileEntry(entry) || !wanted(entry.name)) {
          // Only files the install copies count toward the cap, as in the folder picker.
          continue;
        } else if (folder.files.length >= PICKED_FOLDER_LIMITS.maxFiles) {
          folder.truncated = true;
          return;
        } else {
          try {
            const file = await fileOf(entry);
            const picked: PickedFile = {
              name: file.name,
              relativePath: path,
              size: file.size,
              read: (range) =>
                bytesOf(range ? file.slice(range.offset, range.offset + range.length) : file),
            };
            folder.files.push(picked);
          } catch {
            folder.skipped += 1;
          }
        }
        if (folder.truncated) return;
      }
    }
  };

  await visit(root, '', 0);
  return folder;
}
