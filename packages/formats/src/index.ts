// gp3, gp4 and gp5 (the binary family).
export { readGp3To5 } from './gp3-to-5/read-gp3-to-5';
export type { GpReadResult } from './gp3-to-5/read-gp3-to-5';
export { GpVersionError } from './gp3-to-5/version';
export type { GpFormat, GpVersion } from './gp3-to-5/version';
export type {
  ReaderWarningCode,
  Warning,
  WarningCode,
  WarningLocation,
  WarningSeverity,
} from './warnings';

// gp (Guitar Pro 7 and 8) and the gpif model reader it shares with gpx.
export { GpError, readGp } from './gp/read-gp';
export type { GpErrorCode } from './gp/read-gp';
export { GpifError } from './gpif/errors';
export type { GpifErrorCode } from './gpif/errors';
export { readGpif } from './gpif/read-gpif';
export type { GpifReadOptions, GpifReadResult } from './gpif/read-gpif';
export type { GpifWarning, GpifWarningCode } from './gpif/warnings';

// gpx (Guitar Pro 6): the BCFZ/BCFS container around the same gpif document.
export { GpxError } from './gpx/errors';
export type { GpxErrorCode } from './gpx/errors';
export { readGpx } from './gpx/read-gpx';
export type { GpxReadResult } from './gpx/read-gpx';

// The gp writer: the model as a gpif document, and the Guitar Pro 7 and 8 zip around it.
export { writeGp } from './gp/write-gp';
export type { GpWriteOptions, GpWriteResult } from './gp/write-gp';
export { writeGpif } from './gpif/write-gpif';
export type { GpifWriteResult } from './gpif/write-gpif';
export type { GpifDropCode, GpifDropped } from './gpif/dropped';

// The Formats contract: detection and the read and write dispatchers over every format.
export { detect } from './detect';
export { FormatError } from './errors';
export type { FormatErrorCode, FormatErrorOptions } from './errors';
export { FORMATS, formatOfExtension } from './format';
export type { Format } from './format';
export { MAX_FILE_BYTES } from './limits';
export { read } from './read';
export type { ReadResult } from './read';
export { write } from './write';
export type { WriteOptions, WriteResult } from './write';
