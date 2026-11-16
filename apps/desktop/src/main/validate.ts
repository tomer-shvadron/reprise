import { isAbsolute } from 'node:path';

import type {
  FileFilter,
  HistoryMenuLabels,
  InvokeArgs,
  InvokeChannel,
  PrintOptions,
  ReadRange,
  RecentSong,
} from '@reprise/web';

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

// Repeated from the contract's MAX_READ_LENGTH and MAX_DOWNLOAD_BYTES: desktop imports web for
// types only.
export const MAX_READ_LENGTH = 16 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_DOWNLOAD_ID_LENGTH = 64;
const DOWNLOAD_DIR = ['data', 'sounds'];

const MAX_FILTERS = 16;
const MAX_EXTENSIONS = 32;
const MAX_NAME_LENGTH = 255;
// Repeated from the contract's MAX_RECENT_SONGS: desktop imports web for types only.
const MAX_RECENT_SONGS = 10;
const MAX_RECENT_ID_LENGTH = 128;
const MAX_RECENT_TITLE_LENGTH = 200;
const MAX_HISTORY_LABEL_LENGTH = 100;

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
  // A UNC or device path (`\\host\share`, `\\?\C:`, `//host/share`) makes the realpath that
  // PathAccess runs open a network connection from main; picked paths never take that form.
  if (/^[\\/]{2}/.test(value)) throw new PayloadError('Network and device paths are not accepted');
  return value;
}

/** `{ offset, length }` as non-negative safe integers, the length within `MAX_READ_LENGTH`. */
export function parseReadRange(value: unknown): ReadRange {
  const offset = isRecord(value) ? value['offset'] : undefined;
  const length = isRecord(value) ? value['length'] : undefined;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new PayloadError('Expected a read offset that is a non-negative integer');
  }
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_READ_LENGTH
  ) {
    throw new PayloadError(
      `Expected a read length that is an integer from 0 to ${String(MAX_READ_LENGTH)}`,
    );
  }
  return { offset, length };
}

/** An `https:` URL without credentials; main checks every redirect the same way. */
export function parseHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new PayloadError('Expected a URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PayloadError('Expected a URL');
  }
  if (url.protocol !== 'https:') throw new PayloadError('Only https: URLs are downloaded');
  if (url.username !== '' || url.password !== '') {
    throw new PayloadError('A download URL carries no credentials');
  }
  return url.href;
}

/** A storage path of a file below `data/sounds/`, the only place a download may write. */
export function parseDownloadTarget(value: unknown): string {
  const text = parseStoragePathText(value);
  const segments = text.split('/');
  if (
    segments.length < DOWNLOAD_DIR.length + 1 ||
    !DOWNLOAD_DIR.every((name, index) => segments[index] === name)
  ) {
    throw new PayloadError(`A download goes to a file under ${DOWNLOAD_DIR.join('/')}/`);
  }
  return text;
}

export function parseSha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new PayloadError('Expected a SHA-256 as 64 hex digits');
  }
  return value.toLowerCase();
}

/** A positive integer, clamped to `MAX_DOWNLOAD_BYTES`. */
export function parseMaxBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new PayloadError('Expected maxBytes as a positive integer');
  }
  return Math.min(value, MAX_DOWNLOAD_BYTES);
}

export function parseDownloadId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DOWNLOAD_ID_LENGTH) {
    throw new PayloadError('Expected a download id');
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

function stripUnsafe(text: string): string {
  let kept = '';
  // Every unsafe character is in the BMP, so UTF-16 units are the right grain.
  for (let i = 0; i < text.length; i += 1) {
    if (!isUnsafeTitleChar(text.charCodeAt(i))) kept += text.charAt(i);
  }
  return kept;
}

function cleanTitle(title: string): string {
  const clean = stripUnsafe(title).trim().slice(0, MAX_RECENT_TITLE_LENGTH);
  return clean === '' ? 'Untitled' : clean;
}

/**
 * `{ undo?, redo? }` of command names; a label is cleaned like a title and cut at 100, and one
 * left empty is left out, so main shows the bare item.
 */
export function parseHistoryLabels(value: unknown): HistoryMenuLabels {
  if (!isRecord(value)) throw new PayloadError('Expected the history labels');
  const labels: HistoryMenuLabels = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key !== 'undo' && key !== 'redo') throw new PayloadError(`Unknown history label '${key}'`);
    if (raw === undefined) continue;
    if (typeof raw !== 'string') throw new PayloadError(`Expected a text label for '${key}'`);
    const clean = stripUnsafe(raw).trim().slice(0, MAX_HISTORY_LABEL_LENGTH);
    if (clean !== '') labels[key] = clean;
  }
  return labels;
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
    if (args.length === 1) return [parsePath(args[0])];
    arity(args, 2, 'file:read');
    return [parsePath(args[0]), parseReadRange(args[1])];
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
  'menu:set-history': (args) => {
    arity(args, 1, 'menu:set-history');
    return [parseHistoryLabels(args[0])];
  },
  'app:library-dir': (args) => {
    arity(args, 0, 'app:library-dir');
    return [];
  },
  'app:data-dir': (args) => {
    arity(args, 0, 'app:data-dir');
    return [];
  },
  'window:set-edited': (args) => {
    arity(args, 1, 'window:set-edited');
    if (typeof args[0] !== 'boolean') throw new PayloadError('Expected a boolean');
    return [args[0]];
  },
  'window:close': (args) => {
    arity(args, 1, 'window:close');
    if (typeof args[0] !== 'boolean') throw new PayloadError('Expected a boolean');
    return [args[0]];
  },
  'download:start': (args) => {
    arity(args, 5, 'download:start');
    return [
      parseDownloadId(args[0]),
      parseHttpsUrl(args[1]),
      parseDownloadTarget(args[2]),
      parseSha256(args[3]),
      parseMaxBytes(args[4]),
    ];
  },
  'download:cancel': (args) => {
    arity(args, 1, 'download:cancel');
    return [parseDownloadId(args[0])];
  },
  'app:print': (args) => {
    if (args.length === 0) return [];
    arity(args, 1, 'app:print');
    return [parsePrintOptions(args[0])];
  },
};
