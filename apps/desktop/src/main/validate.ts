import { isAbsolute } from 'node:path';

import type { FileFilter, InvokeArgs, InvokeChannel, PrintOptions, RecentSong } from '@reprise/web';

import { isStoragePath, parseStoragePath, StoragePathError } from './storage-path';

/** The path as sent once it has passed the syntax check; main resolves it against a root. */
const parseStoragePathText = (value: unknown): string => {
  try {
    parseStoragePath(value);
  } catch (error) {
    if (error instanceof StoragePathError) throw new PayloadError(error.message);
    throw error;
  }
  return String(value);
};

/** Thrown when the renderer sends a payload that does not match its channel's type. */
export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

const MAX_FILTERS = 16;
const MAX_EXTENSIONS = 32;
const MAX_NAME_LENGTH = 255;
// Repeated from the contract's MAX_RECENT_SONGS: desktop imports web for types only.
const MAX_RECENT_SONGS = 10;
const MAX_RECENT_ID_LENGTH = 128;
const MAX_RECENT_TITLE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arity(args: readonly unknown[], expected: number, channel: InvokeChannel): void {
  if (args.length !== expected) {
    throw new PayloadError(
      `${channel} takes ${String(expected)} arguments, got ${String(args.length)}`,
    );
  }
}

export function parseName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_NAME_LENGTH ||
    /[/\\\0]/.test(value)
  ) {
    throw new PayloadError('Expected a file name without path separators');
  }
  return value;
}

/** A storage path (`library/...`, `data/...`) or an absolute path of a picked or saved file. */
export function parsePath(value: unknown): string {
  if (typeof value === 'string' && isStoragePath(value)) return parseStoragePathText(value);
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
    throw new PayloadError('Expected a storage path or an absolute path');
  }
  return value;
}

export function parseBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new PayloadError('Expected a Uint8Array');
  return value;
}

export function parseFilters(value: unknown): FileFilter[] {
  if (!Array.isArray(value) || value.length > MAX_FILTERS) {
    throw new PayloadError(`Expected up to ${String(MAX_FILTERS)} file filters`);
  }
  return value.map((filter: unknown) => {
    if (!isRecord(filter) || typeof filter['name'] !== 'string') {
      throw new PayloadError('Expected a file filter with a name');
    }
    const extensions = filter['extensions'];
    if (
      !Array.isArray(extensions) ||
      extensions.length === 0 ||
      extensions.length > MAX_EXTENSIONS ||
      !extensions.every((ext: unknown) => typeof ext === 'string' && /^[a-z0-9]+$/i.test(ext))
    ) {
      throw new PayloadError('Expected file filter extensions as letters and digits, no dot');
    }
    return { name: filter['name'], extensions: extensions.map(String) };
  });
}

export function parsePrintOptions(value: unknown): PrintOptions {
  const pageSize = isRecord(value) ? value['pageSize'] : undefined;
  if (pageSize !== 'A4' && pageSize !== 'Letter') {
    throw new PayloadError("Expected print options with pageSize 'A4' or 'Letter'");
  }
  return { pageSize };
}

// C0 and C1 controls (a tab starts accelerator text in a Windows menu label), the line and
// paragraph separators, and the bidi embeddings, overrides and isolates (one entry can be made
// to read like another).
function isUnsafeTitleChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function cleanTitle(title: string): string {
  let kept = '';
  // Every unsafe character is in the BMP, so UTF-16 units are the right grain.
  for (let i = 0; i < title.length; i += 1) {
    if (!isUnsafeTitleChar(title.charCodeAt(i))) kept += title.charAt(i);
  }
  const clean = kept.trim().slice(0, MAX_RECENT_TITLE_LENGTH);
  return clean === '' ? 'Untitled' : clean;
}

/** At most ten items; an id is opaque so an overlong one is refused, a title is cut. */
export function parseRecentSongs(value: unknown): RecentSong[] {
  if (!Array.isArray(value)) throw new PayloadError('Expected a list of recent songs');
  return value.slice(0, MAX_RECENT_SONGS).map((item: unknown) => {
    const id = isRecord(item) ? item['id'] : undefined;
    const title = isRecord(item) ? item['title'] : undefined;
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > MAX_RECENT_ID_LENGTH ||
      typeof title !== 'string'
    ) {
      throw new PayloadError('Expected a recent song with an id and a title');
    }
    return { id, title: cleanTitle(title) };
  });
}

export type Parsers = { [C in InvokeChannel]: (args: readonly unknown[]) => InvokeArgs<C> };

/** One parser per channel, so a channel added to the map without a validator fails typecheck. */
export const parsers: Parsers = {
  'file:open': (args) => {
    arity(args, 1, 'file:open');
    return [parseFilters(args[0])];
  },
  'file:save': (args) => {
    arity(args, 3, 'file:save');
    return [parseName(args[0]), parseBytes(args[1]), parseFilters(args[2])];
  },
  'file:read': (args) => {
    arity(args, 1, 'file:read');
    return [parsePath(args[0])];
  },
  'file:write': (args) => {
    arity(args, 2, 'file:write');
    return [parsePath(args[0]), parseBytes(args[1])];
  },
  'file:open-many': (args) => {
    arity(args, 1, 'file:open-many');
    return [parseFilters(args[0])];
  },
  'folder:open': (args) => {
    arity(args, 1, 'folder:open');
    return [parseFilters(args[0])];
  },
  'storage:mkdir': (args) => {
    arity(args, 1, 'storage:mkdir');
    return [parseStoragePathText(args[0])];
  },
  'storage:list': (args) => {
    arity(args, 1, 'storage:list');
    return [parseStoragePathText(args[0])];
  },
  'storage:move': (args) => {
    arity(args, 2, 'storage:move');
    return [parseStoragePathText(args[0]), parseStoragePathText(args[1])];
  },
  'storage:remove': (args) => {
    arity(args, 1, 'storage:remove');
    return [parseStoragePathText(args[0])];
  },
  'menu:set-recent': (args) => {
    arity(args, 1, 'menu:set-recent');
    return [parseRecentSongs(args[0])];
  },
  'app:library-dir': (args) => {
    arity(args, 0, 'app:library-dir');
    return [];
  },
  'app:data-dir': (args) => {
    arity(args, 0, 'app:data-dir');
    return [];
  },
  'app:print': (args) => {
    if (args.length === 0) return [];
    arity(args, 1, 'app:print');
    return [parsePrintOptions(args[0])];
  },
};
