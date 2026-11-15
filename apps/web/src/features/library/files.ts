import type { Id } from '@reprise/model';

import type { Platform } from '@/platform/platform';

import type { SongRow } from './db/rows';
import { originalsDirOf, trashDirOf, TRASH_DIR } from './paths';

/**
 * The library's files, behind the paths in `paths.ts`. A port over `Platform` so tests can
 * count calls; the platform's own storage rules (root-relative paths, parents created on write)
 * do the rest.
 */
export interface LibraryFiles {
  /** Writes the native and, when there is one, the original; removes both again if one fails. */
  write(row: SongRow, native: Uint8Array, original: Uint8Array | undefined): Promise<void>;
  /** Removes whatever `write` may have left for the row; never rejects. */
  discard(row: SongRow): Promise<void>;
  /** Moves the song's files and a JSON copy of its row to `trash/<id>/`. */
  trash(row: SongRow): Promise<void>;
}

type FileOps = Pick<Platform, 'writeFile' | 'move' | 'remove' | 'listDir' | 'mkdir'>;

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

async function exists(platform: FileOps, path: string): Promise<boolean> {
  const entries = await platform.listDir(parentOf(path));
  return entries.some((entry) => entry.name === path.slice(path.lastIndexOf('/') + 1));
}

/** The first of `<id>`, `<id>-2`, … that the trash does not hold yet. */
async function freeTrashName(platform: FileOps, id: Id): Promise<string> {
  const taken = new Set((await platform.listDir(TRASH_DIR)).map((entry) => entry.name));
  let name: string = id;
  for (let n = 2; taken.has(name); n += 1) name = `${id}-${String(n)}`;
  return name;
}

export function createLibraryFiles(platform: FileOps): LibraryFiles {
  const discard = async (row: SongRow) => {
    await Promise.allSettled([
      platform.remove(row.nativePath),
      platform.remove(originalsDirOf(row.id)),
    ]);
  };
  return {
    discard,
    async write(row, native, original) {
      try {
        await platform.writeFile(row.nativePath, native);
        if (original) await platform.writeFile(row.originalPath, original);
      } catch (error) {
        await discard(row);
        throw error;
      }
    },
    async trash(row) {
      const folder = trashDirOf(await freeTrashName(platform, row.id));
      // The copy of the row first: if a move below fails, the row is still in the database and
      // the copy is only a stray file in the trash.
      await platform.writeFile(
        `${folder}/song.json`,
        new TextEncoder().encode(JSON.stringify(row, null, 2)),
      );
      if (await exists(platform, row.nativePath)) {
        await platform.move(
          row.nativePath,
          `${folder}/${row.nativePath.split('/').pop() ?? 'song.reprise'}`,
        );
      }
      const originals = originalsDirOf(row.id);
      if (await exists(platform, originals)) await platform.move(originals, `${folder}/original`);
    },
  };
}
