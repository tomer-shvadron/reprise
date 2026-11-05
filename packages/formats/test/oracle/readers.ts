import type { Score } from '@reprise/model';

import { readGp, readGp3To5 } from '../../src/index';

export type FixtureFormat = 'gp3' | 'gp4' | 'gp5' | 'gp' | 'gpx';

export interface OracleReader {
  extension: FixtureFormat;
  read: (bytes: Uint8Array) => Score;
}

/** One entry per file extension; adding a reader to the oracle is one line here. */
export const READERS: readonly OracleReader[] = [
  { extension: 'gp3', read: (bytes) => readGp3To5(bytes).score },
  { extension: 'gp4', read: (bytes) => readGp3To5(bytes).score },
  { extension: 'gp5', read: (bytes) => readGp3To5(bytes).score },
  { extension: 'gp', read: (bytes) => readGp(bytes).score },
];

export interface PendingReader {
  extension: FixtureFormat;
  workPackage: string;
  /** The name `@reprise/formats` will export it under; the test fails once that export exists
   * and the entry has not moved to `READERS`. */
  exportName: string;
}

/** TODO(WP-043): move the entry to `READERS` when the gpx reader lands. */
export const PENDING_READERS: readonly PendingReader[] = [
  { extension: 'gpx', workPackage: 'WP-043', exportName: 'readGpx' },
];
