import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import type { FileFilter, PickedFileInfo, PickedFolderInfo } from '@reprise/web';

// Repeated from the contract's PICKED_FOLDER_LIMITS: desktop imports web for types only.
export const FOLDER_LIMITS = { maxFiles: 10_000, maxDepth: 16, maxEntries: 100_000 } as const;

interface Limits {
  maxFiles: number;
  maxDepth: number;
  maxEntries: number;
}

export async function describePickedFile(
  path: string,
  relativePath = basename(path),
): Promise<PickedFileInfo> {
  return { name: basename(path), relativePath, size: (await stat(path)).size, path };
}

/**
 * Walks a folder the user picked, in name order, keeping the files whose extension a filter
 * lists. Dot entries and symlinks are skipped; a walk that stops at a limit says so, and a
 * folder below the root that cannot be read (macOS privacy folders, Windows system folders) is
 * skipped and counted. The root itself failing to read rejects the pick.
 */
export async function walkFolder(
  dir: string,
  filters: readonly FileFilter[],
  limits: Limits = FOLDER_LIMITS,
): Promise<PickedFolderInfo> {
  const wanted = new Set(
    filters.flatMap(({ extensions }) => extensions.map((e) => e.toLowerCase())),
  );
  const files: PickedFileInfo[] = [];
  let truncated = false;
  // Only the file cap ends the walk; a folder cut by depth leaves its siblings to be listed.
  let full = false;
  let visited = 0;
  let skipped = 0;

  async function walk(current: string, prefix: string, depth: number): Promise<void> {
    let listing;
    try {
      listing = await readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
      if (depth === 0 || (code !== 'EACCES' && code !== 'EPERM')) throw error;
      skipped += 1;
      return;
    }
    const entries = listing.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (full) return;
      if (visited >= limits.maxEntries) {
        truncated = full = true;
        return;
      }
      visited += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth >= limits.maxDepth) truncated = true;
        else await walk(path, relativePath, depth + 1);
      } else if (entry.isFile() && wanted.has(extname(entry.name).slice(1).toLowerCase())) {
        if (files.length >= limits.maxFiles) truncated = full = true;
        else files.push(await describePickedFile(path, relativePath));
      }
    }
  }

  await walk(dir, '', 0);
  return { name: basename(dir), files, truncated, skipped };
}
