import type { NativeFormatErrorCode } from '@reprise/model';

import type { Format } from './format';
import type { GpErrorCode } from './gp/read-gp';
import type { GpifErrorCode } from './gpif/errors';
import type { GpxErrorCode } from './gpx/errors';

export type FormatErrorCode =
  | 'unknown-format'
  | 'format-mismatch'
  | 'too-large'
  | 'unknown-version'
  | GpErrorCode
  | GpxErrorCode
  | GpifErrorCode
  | NativeFormatErrorCode;

export interface FormatErrorOptions {
  /** The format whose reader or writer failed. */
  format?: Format;
  /** On `format-mismatch`, what the bytes are. */
  detected?: Format;
  cause?: unknown;
}

/** Why `read` or `write` could not produce a result; a reader's own error is the `cause`. */
export class FormatError extends Error {
  override readonly name = 'FormatError';
  readonly code: FormatErrorCode;
  readonly format?: Format;
  readonly detected?: Format;

  constructor(code: FormatErrorCode, message: string, options: FormatErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    if (options.format !== undefined) this.format = options.format;
    if (options.detected !== undefined) this.detected = options.detected;
  }
}
