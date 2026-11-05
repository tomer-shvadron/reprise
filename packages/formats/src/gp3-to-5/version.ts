import { BinaryReader, TruncatedFile } from '../binary/binary-reader';

/** Guitar Pro's version as major × 100 + minor: 300, 400, 406, 500 or 510. */
export type GpVersion = 300 | 400 | 406 | 500 | 510;

export type GpFormat = 'gp3' | 'gp4' | 'gp5';

const PREFIX = 'FICHIER GUITAR PRO ';

/**
 * The versions Guitar Pro 3 to 5 wrote. The letter before the number is `v` in files Guitar Pro
 * saved and `L` in some it exported, and does not change the layout.
 */
const KNOWN: Readonly<Record<string, GpVersion>> = {
  '3.00': 300,
  '4.00': 400,
  '4.06': 406,
  '5.00': 500,
  '5.10': 510,
};

/** The file is not a Guitar Pro 3 to 5 file this reader knows, or too short to tell. */
export class GpVersionError extends Error {
  readonly code = 'unknown-version';
  /** The header text as read, `''` when the file is too short to hold one. */
  readonly version: string;

  constructor(version: string) {
    super(
      version === ''
        ? 'not a Guitar Pro 3 to 5 file: no version header'
        : `unsupported Guitar Pro version "${version}"`,
    );
    this.name = 'GpVersionError';
    this.version = version;
  }
}

/** Reads the 31-byte header: a length byte and a 30-byte field. */
export function readVersion(reader: BinaryReader): GpVersion {
  let header: string;
  try {
    header = reader.fixedString(30);
  } catch (error) {
    if (error instanceof TruncatedFile) throw new GpVersionError('');
    throw error;
  }
  const version = header.startsWith(PREFIX) ? KNOWN[header.slice(PREFIX.length + 1)] : undefined;
  if (version === undefined) throw new GpVersionError(header);
  return version;
}

export function formatOf(version: GpVersion): GpFormat {
  if (version >= 500) return 'gp5';
  return version >= 400 ? 'gp4' : 'gp3';
}
