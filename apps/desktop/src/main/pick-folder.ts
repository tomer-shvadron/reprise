import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import type { FileFilter, PickedFileInfo, PickedFolderInfo } from '@reprise/web';

// Repeated from the contract's PICKED_FOLDER_LIMITS: desktop imports web for types only.
export const FOLDER_LIMITS = { maxFiles: 10_000, maxDepth: 16 } as const;

export async function describePickedFile(
  path: string,
  relativePath = basename(path),
): Promise<PickedFileInfo> {
  return { name: basename(path), relativePath, size: (await stat(path)).size, path };
}

/**
 * Walks a folder the user picked, in name order, keeping the files whose extension a filter
 * lists. Dot entries and symlinks are skipped; a walk that stops at a limit says so.
 */
export async function walkFolder(
  dir: string,
  filters: readonly FileFilter[],
  limits: { maxFiles: number; maxDepth: number } = FOLDER_LIMITS,
): Promise<PickedFolderInfo> {
  const wanted = new Set(
    filters.flatMap(({ extensions }) => extensions.map((e) => e.toLowerCase())),
  );
  const files: PickedFileInfo[] = [];
  let truncated = false;
  // Only the file cap ends the walk; a folder cut by depth leaves its siblings to be listed.
  let full = false;

  async function walk(current: string, prefix: string, depth: number): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (full) return;
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
  return { name: basename(dir), files, truncated };
}
