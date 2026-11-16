import { newId } from '@reprise/model';

import type { SongRow } from './db/rows';
import { nativePathOf, originalPathOf } from './paths';

let counter = 0;

/** A valid row with distinct, readable defaults; override what the test is about. */
export function rowOf(overrides: Partial<SongRow> = {}): SongRow {
  counter += 1;
  const id = overrides.id ?? newId();
  return {
    id,
    title: `Song ${String(counter)}`,
    artist: 'Artist',
    album: 'Album',
    sourceFormat: 'gp5',
    nativePath: nativePathOf(id),
    originalPath: originalPathOf(id, 'song.gp5'),
    originalName: 'song.gp5',
    originalKey: `key-${id}`,
    importedAt: counter,
    bars: 4,
    tracks: [{ name: 'Guitar' }],
    ...overrides,
  };
}

let databases = 0;

/** A database name no other test in the file has used, so fake-indexeddb state never leaks. */
export function uniqueDbName(): string {
  databases += 1;
  return `reprise-test-${String(databases)}-${newId()}`;
}

/** A row of a song that began in Reprise, which has no original file. */
export function rowWithoutOriginal(overrides: Partial<SongRow> = {}): SongRow {
  const row = rowOf(overrides);
  delete row.originalPath;
  return row;
}
