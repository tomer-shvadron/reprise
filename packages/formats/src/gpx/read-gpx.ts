import { readGpifWith, type GpifReadResult } from '../gpif/read-gpif';
import { SECTOR_BYTES, readBcfs } from './bcfs';
import { decompressBcfz, hasMagic } from './bcfz';
import { GpxError } from './errors';
import { gp6Hooks } from './gp6-differences';

export interface GpxReadResult extends GpifReadResult {
  format: 'gpx';
}

const SCORE_FILE = 'score.gpif';
const PART_CONFIGURATION_FILE = 'PartConfiguration';

/**
 * Reads a Guitar Pro 6 file: a BCFZ-compressed BCFS file system whose `score.gpif` holds the
 * score, in the gpif vocabulary Guitar Pro 7 kept. Only that file and the `PartConfiguration`
 * beside it are copied out; the stylesheet, layout and `misc.xml` are view state. An
 * uncompressed `BCFS` image is accepted too, as Guitar Pro 6's own reader does. Throws
 * `GpxError` for a container that cannot be opened and the gpif reader's `GpifError` for an
 * unreadable score.
 */
export function readGpx(bytes: Uint8Array): GpxReadResult {
  const content = hasMagic(bytes, 'BCFS')
    ? { bytes, declaredLength: bytes.length }
    : decompressBcfz(bytes);
  const files = readBcfs(
    content.bytes,
    (name) => name === SCORE_FILE || name === PART_CONFIGURATION_FILE,
    content.declaredLength,
  );
  const score = files.find((file) => file.name === SCORE_FILE)?.data;
  if (!score) {
    // An entry can only be missing for want of data when more than the unwritten tail is gone.
    const short = content.declaredLength - content.bytes.length >= SECTOR_BYTES;
    throw short
      ? new GpxError('truncated', `The file ends before its ${SCORE_FILE} entry`)
      : new GpxError(
          'missing-score',
          `The file system has no ${SCORE_FILE}; not a Guitar Pro 6 file`,
        );
  }
  const partConfiguration = files.find((file) => file.name === PART_CONFIGURATION_FILE)?.data;
  const result = readGpifWith(score, partConfiguration ? { partConfiguration } : {}, gp6Hooks());
  return { ...result, format: 'gpx' };
}
