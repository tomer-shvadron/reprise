import type { Id, Score } from '@reprise/model';

import type { SongsRepository } from '../db/repository';
import type { SongRow } from '../db/rows';
import type { LibraryFiles } from '../files';
import { summarize } from './parse-import';
import type { Parser } from './parser';
import { newSongRow } from './song-row';

export interface PersistDeps {
  repo: SongsRepository;
  files: LibraryFiles;
  createParser: () => Parser;
  now: () => number;
}

export interface PersistInput {
  songId: Id;
  /** The open document's score: the native is written from it, so its ids are the open ones. */
  score: Score;
  name: string;
  format: SongRow['sourceFormat'];
  /** SHA-256 hex of the original bytes. */
  key: string;
  /** The original file, copied into the library as it was read. */
  original: Uint8Array;
}

/**
 * Stores the open document as a library song: the native from the score the user sees (never a
 * second read of the file, which would mint other track ids), the original beside it, then the
 * row. Leaves no file behind when a step fails. Never touches the document.
 */
export async function persistDocument(deps: PersistDeps, input: PersistInput): Promise<SongRow> {
  const parser = deps.createParser();
  let native: Uint8Array;
  try {
    const outcome = await parser.native(input.score);
    if (!outcome.ok) throw new Error(outcome.message);
    native = outcome.native;
  } finally {
    parser.dispose();
  }
  const row = newSongRow({
    id: input.songId,
    name: input.name,
    format: input.format,
    key: input.key,
    meta: summarize(input.score),
    now: deps.now(),
    opened: true,
  });
  try {
    await deps.files.write(row, native, input.original);
    await deps.repo.add(row);
  } catch (error) {
    await deps.files.discard(row);
    throw error;
  }
  return row;
}
