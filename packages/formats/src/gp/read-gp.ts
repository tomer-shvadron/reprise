import { unzipSync } from 'fflate';

import { readGpif, type GpifReadResult } from '../gpif/read-gpif';

export type GpErrorCode = 'invalid-zip' | 'missing-score';

export class GpError extends Error {
  override readonly name = 'GpError';
  readonly code: GpErrorCode;

  constructor(code: GpErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const SCORE_ENTRY = 'Content/score.gpif';
const PART_CONFIGURATION_ENTRY = 'Content/PartConfiguration';

/**
 * Reads a Guitar Pro 7 or 8 file: a zip whose `Content/score.gpif` holds the score. Only that
 * entry and the part configuration beside it are inflated; the stylesheets, layout and
 * preferences are Guitar Pro's view state. Throws `GpError` for a damaged zip or a missing
 * score, and the gpif reader's `GpifError` for an unreadable score.
 */
export function readGp(bytes: Uint8Array): GpifReadResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => file.name === SCORE_ENTRY || file.name === PART_CONFIGURATION_ENTRY,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GpError('invalid-zip', `Not a readable Guitar Pro 7/8 file (zip): ${reason}`);
  }
  const score = entries[SCORE_ENTRY];
  if (!score)
    throw new GpError('missing-score', `The zip has no ${SCORE_ENTRY}; not a Guitar Pro 7/8 file`);
  const partConfiguration = entries[PART_CONFIGURATION_ENTRY];
  return readGpif(score, partConfiguration ? { partConfiguration } : {});
}
