import { basename } from 'node:path';

import type { OpenedFile } from '@reprise/web';

/** The picked path is the handle, granted here so the renderer's Save can write back to it. */
export async function openedFile(
  result: { canceled: boolean; filePaths: readonly string[] },
  access: { grant(path: string): void },
  read: (path: string) => Promise<Uint8Array>,
): Promise<OpenedFile | undefined> {
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) return undefined;
  access.grant(path);
  return { name: basename(path), bytes: await read(path), handle: path };
}
