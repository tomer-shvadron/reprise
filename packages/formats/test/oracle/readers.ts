import type { Score } from '@reprise/model';

import { readGp3To5 } from '../../src/index';

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
];

export interface PendingReader {
  extension: FixtureFormat;
  workPackage: string;
  /** The name `@reprise/formats` will export it under; the test fails once that export exists
   * and the entry has not moved to `READERS`. */
  exportName: string;
}

/** TODO(WP-042, WP-043): move each entry to `READERS` when its reader lands. */
export const PENDING_READERS: readonly PendingReader[] = [
  { extension: 'gp', workPackage: 'WP-042', exportName: 'readGp' },
  { extension: 'gpx', workPackage: 'WP-043', exportName: 'readGpx' },
];
