export const packageName = '@reprise/formats';

// gp (Guitar Pro 7 and 8) and the gpif model reader it shares with gpx.
export { GpError, readGp } from './gp/read-gp';
export type { GpErrorCode } from './gp/read-gp';
export { GpifError } from './gpif/errors';
export type { GpifErrorCode } from './gpif/errors';
export { readGpif } from './gpif/read-gpif';
export type { GpifReadOptions, GpifReadResult } from './gpif/read-gpif';
export type { GpifWarning, GpifWarningCode } from './gpif/warnings';
