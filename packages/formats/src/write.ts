import { NativeFormatError, serializeNative } from '@reprise/model';
import type { AppInfo, Score } from '@reprise/model';

import { FormatError } from './errors';
import { writeGp } from './gp/write-gp';
import { fromGpifDropped } from './warning-adapters';
import type { Warning } from './warnings';

export interface WriteOptions {
  /** Stamped into a `.reprise` file for diagnostics; never changes how it is read. Ignored for `gp`. */
  app?: AppInfo;
}

export interface WriteResult {
  bytes: Uint8Array;
  /** What the target format cannot hold and was left out. */
  dropped: Warning[];
}

export const DEFAULT_APP: AppInfo = { name: 'reprise', version: '0.0.0' };

function writeNative(score: Score, app: AppInfo): WriteResult {
  try {
    return { bytes: serializeNative(score, app), dropped: [] };
  } catch (error) {
    if (!(error instanceof NativeFormatError)) throw error;
    throw new FormatError(error.code, error.message, { format: 'reprise', cause: error });
  }
}

function writeNow(score: Score, format: 'reprise' | 'gp', options: WriteOptions): WriteResult {
  if (format === 'reprise') return writeNative(score, options.app ?? DEFAULT_APP);
  const { bytes, dropped } = writeGp(score);
  return { bytes, dropped: dropped.map(fromGpifDropped) };
}

/** Writes a score as `.reprise` or `.gp`. Rejects with `FormatError` and never throws synchronously. */
export function write(
  score: Score,
  format: 'reprise' | 'gp',
  options: WriteOptions = {},
): Promise<WriteResult> {
  return new Promise((resolve) => {
    resolve(writeNow(score, format, options));
  });
}
