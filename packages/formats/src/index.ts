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
