import { NativeFormatError, parseNative } from '@reprise/model';
import type { Score } from '@reprise/model';

import { detect } from './detect';
import { FormatError } from './errors';
import type { FormatErrorCode } from './errors';
import type { Format } from './format';
import { GpError, readGp } from './gp/read-gp';
import { readGp3To5 } from './gp3-to-5/read-gp3-to-5';
import { GpVersionError } from './gp3-to-5/version';
import { GpifError } from './gpif/errors';
import { GpxError } from './gpx/errors';
import { readGpx } from './gpx/read-gpx';
import { MAX_FILE_BYTES } from './limits';
import { fromGpifWarning, fromParseWarning, withFoldedCount } from './warning-adapters';
import type { Warning } from './warnings';

export interface ReadResult {
  score: Score;
  warnings: Warning[];
}

/** Codes a reader gives bytes that are not its format at all, as opposed to a damaged file. */
const NOT_THIS_FORMAT: ReadonlySet<FormatErrorCode> = new Set<FormatErrorCode>([
  'unknown-version',
  'invalid-zip',
  'not-bcfz',
  'invalid-utf8',
  'invalid-json',
  'wrong-format',
]);

type Reader = 'binary' | 'gp' | 'gpx' | 'reprise';

function readerOf(format: Format): Reader {
  return format === 'gp3' || format === 'gp4' || format === 'gp5' ? 'binary' : format;
}

function dispatch(bytes: Uint8Array, format: Format): ReadResult {
  switch (readerOf(format)) {
    case 'binary': {
      const { score, warnings } = readGp3To5(bytes);
      return { score, warnings: warnings.map(withFoldedCount) };
    }
    case 'gp': {
      const { score, warnings } = readGp(bytes);
      return { score, warnings: warnings.map(fromGpifWarning) };
    }
    case 'gpx': {
      const { score, warnings } = readGpx(bytes);
      return { score, warnings: warnings.map(fromGpifWarning) };
    }
    case 'reprise': {
      const { score, warnings } = parseNative(bytes);
      return { score, warnings: warnings.map(fromParseWarning) };
    }
  }
}

function isReaderError(
  error: unknown,
): error is GpVersionError | GpError | GpxError | GpifError | NativeFormatError {
  return (
    error instanceof GpVersionError ||
    error instanceof GpError ||
    error instanceof GpxError ||
    error instanceof GpifError ||
    error instanceof NativeFormatError
  );
}

/**
 * A reader's error as a `FormatError`. When the caller named the format and its reader says the
 * bytes are not that format at all, the bytes are sniffed: a different family becomes
 * `format-mismatch`. Anything that is not a reader error is a bug and is rethrown as it is.
 */
function toFormatError(
  error: unknown,
  bytes: Uint8Array,
  chosen: Format,
  given: Format | undefined,
): FormatError {
  if (!isReaderError(error)) throw error;
  if (given !== undefined && NOT_THIS_FORMAT.has(error.code)) {
    const detected = detect(bytes);
    if (detected !== undefined && readerOf(detected) !== readerOf(given)) {
      return new FormatError('format-mismatch', `The file is a ${detected} file, not ${given}`, {
        format: given,
        detected,
        cause: error,
      });
    }
  }
  return new FormatError(error.code, error.message, { format: chosen, cause: error });
}

function readNow(bytes: Uint8Array, format: Format | undefined): ReadResult {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new FormatError(
      'too-large',
      `The file is ${String(bytes.length)} bytes; the limit is ${String(MAX_FILE_BYTES)}`,
      format === undefined ? {} : { format },
    );
  }
  const chosen = format ?? detect(bytes);
  if (chosen === undefined) {
    throw new FormatError('unknown-format', 'Not a Guitar Pro or Reprise file');
  }
  try {
    return dispatch(bytes, chosen);
  } catch (error) {
    throw toFormatError(error, bytes, chosen, format);
  }
}

/**
 * Reads any supported file into a score. The bytes decide the format unless `format` is given,
 * in which case it picks the reader; gp3, gp4 and gp5 share one reader whose header decides
 * the version. Rejects with `FormatError` and never throws synchronously.
 */
export function read(bytes: Uint8Array, format?: Format): Promise<ReadResult> {
  // The executor turns a throw into a rejection; the promise leaves room for a worker later.
  return new Promise((resolve) => {
    resolve(readNow(bytes, format));
  });
}
