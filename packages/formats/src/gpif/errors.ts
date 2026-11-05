export type GpifErrorCode = 'invalid-utf8' | 'invalid-xml' | 'not-gpif' | 'empty-score';

/** A gpif document that cannot become a score at all. Recoverable problems are warnings. */
export class GpifError extends Error {
  override readonly name = 'GpifError';
  readonly code: GpifErrorCode;
  /** 1-based position of an XML syntax error; absent for the other codes. */
  readonly line?: number;
  readonly column?: number;

  constructor(code: GpifErrorCode, message: string, position?: { line: number; column: number }) {
    super(message);
    this.code = code;
    if (position) {
      this.line = position.line;
      this.column = position.column;
    }
  }
}
