/**
 * Global setup of `pnpm sfz:check`: reads the pack directory in Node, since `@reprise/audio` is
 * typed without Node's modules. SFZ text is read whole; every other file contributes its size and
 * its first bytes, which is all a header check needs, so a multi-gigabyte pack stays cheap.
 */
import { lstatSync, openSync, readSync, readdirSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { TestProject } from 'vitest/node';

export const DIR_ENV = 'REPRISE_SFZ_DIR';

const TEXT = /\.(sfz|sfzh|inc|txt)$/i;
const HEAD_BYTES = 65_536;
/** A text file beyond this is no SFZ file; reading its head keeps a stray dump from filling memory. */
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

interface Entry {
  size: number;
  bytes: Uint8Array;
}

function readHead(path: string, length: number): Uint8Array {
  const handle = openSync(path, 'r');
  try {
    const buffer = new Uint8Array(length);
    const read = readSync(handle, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(handle);
  }
}

/** Regular files only: a symlink inside a downloaded pack is not followed. */
export function snapshotDirectory(root: string): Record<string, Entry> {
  const files: Record<string, Entry> = {};
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile()) {
        const size = lstatSync(path).size;
        const length = TEXT.test(entry.name) ? Math.min(size, MAX_TEXT_BYTES) : HEAD_BYTES;
        files[relative] = { size, bytes: readHead(path, Math.min(size, length)) };
      }
    }
  };
  walk(root, '');
  return files;
}

declare module 'vitest' {
  export interface ProvidedContext {
    sfzPack: Record<string, Entry>;
    sfzPackName: string;
  }
}

export default function setup(project: TestProject): void {
  const directory = process.env[DIR_ENV];
  if (directory === undefined) throw new Error(`${DIR_ENV} is not set; run pnpm sfz:check <dir>`);
  project.provide('sfzPack', snapshotDirectory(directory));
  project.provide('sfzPackName', basename(directory));
}
