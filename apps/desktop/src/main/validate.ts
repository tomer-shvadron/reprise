import { isAbsolute } from 'node:path';

import type { FileFilter, InvokeArgs, InvokeChannel, PrintOptions } from '@reprise/web';

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

export function parsePath(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
    throw new PayloadError('Expected an absolute path');
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
