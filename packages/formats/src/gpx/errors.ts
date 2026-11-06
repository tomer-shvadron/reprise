export type GpxErrorCode = 'not-bcfz' | 'truncated' | 'too-large' | 'corrupt' | 'missing-score';

/** A gpx container that cannot be opened. A readable `score.gpif` with problems is `GpifError`'s. */
export class GpxError extends Error {
  override readonly name = 'GpxError';
  readonly code: GpxErrorCode;

  constructor(code: GpxErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
