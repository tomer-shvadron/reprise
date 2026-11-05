import { unzipSync } from 'fflate';

import { readGpif, type GpifReadResult } from '../gpif/read-gpif';

export type GpErrorCode = 'invalid-zip' | 'missing-score' | 'too-large';

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
 * fflate allocates each entry's declared inflated size before inflating, so a zip whose central
 * directory lies about it would allocate that much. A 38,400-note score is 13 MB of gpif.
 */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

/**
 * Reads a Guitar Pro 7 or 8 file: a zip whose `Content/score.gpif` holds the score. Only that
 * entry and the part configuration beside it are inflated; the stylesheets, layout and
 * preferences are Guitar Pro's view state. Throws `GpError` for a damaged zip, a missing score
 * or an entry declaring more than `MAX_ENTRY_BYTES`, and the gpif reader's `GpifError` for an
 * unreadable score.
 */
export function readGp(bytes: Uint8Array): GpifReadResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== SCORE_ENTRY && file.name !== PART_CONFIGURATION_ENTRY) return false;
        if (file.originalSize > MAX_ENTRY_BYTES) {
          throw new GpError(
            'too-large',
            `${file.name} declares ${String(file.originalSize)} bytes; the limit is ${String(MAX_ENTRY_BYTES)}`,
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof GpError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new GpError('invalid-zip', `Not a readable Guitar Pro 7/8 file (zip): ${reason}`);
  }
  const score = entries[SCORE_ENTRY];
  if (!score)
    throw new GpError('missing-score', `The zip has no ${SCORE_ENTRY}; not a Guitar Pro 7/8 file`);
  const partConfiguration = entries[PART_CONFIGURATION_ENTRY];
  return readGpif(score, partConfiguration ? { partConfiguration } : {});
}
