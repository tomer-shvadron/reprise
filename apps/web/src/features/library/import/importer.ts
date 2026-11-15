import { formatOfExtension, MAX_FILE_BYTES } from '@reprise/formats';
import { newId } from '@reprise/model';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { SongsRepository } from '../db/repository';
import type { SongRow } from '../db/rows';
import type { LibraryFiles } from '../files';
import type { Parser } from './parser';
import type { ImportSource } from './sources';
import { newSongRow, stem } from './song-row';

const MB = 1024 * 1024;
/** How often the library's list is refreshed while a batch runs, so 10 000 files do not mean 10 000 sorts. */
const FLUSH_MS = 250;

export interface ImportFailure {
  name: string;
  message: string;
}

export interface ImportProgress {
  /** `done` keeps the summary on screen until the user dismisses it. */
  phase: 'idle' | 'running' | 'done';
  total: number;
  done: number;
  imported: number;
  duplicates: number;
  failed: ImportFailure[];
  /** Files that were not Guitar Pro or Reprise files by their extension. */
  skipped: number;
  /** A folder the walk cut short, or folders it could not read. */
  truncated: boolean;
  unreadableFolders: number;
  cancelled: boolean;
  current: string | undefined;
}

export type ImportStore = UseBoundStore<StoreApi<ImportProgress>>;

const idle = (): ImportProgress => ({
  phase: 'idle',
  total: 0,
  done: 0,
  imported: 0,
  duplicates: 0,
  failed: [],
  skipped: 0,
  truncated: false,
  unreadableFolders: 0,
  cancelled: false,
  current: undefined,
});

export interface ImporterDeps {
  repo: SongsRepository;
  files: LibraryFiles;
  createParser: () => Parser;
  now: () => number;
  /** Rows added since the last call, a few at a time. */
  onAdded: (rows: SongRow[]) => void;
}

export interface BatchNotes {
  truncated?: boolean;
  unreadableFolders?: number;
}

export interface Importer {
  store: ImportStore;
  /** Adds to the running batch, or starts one. Resolves when the batch has finished. */
  add(sources: readonly ImportSource[], notes?: BatchNotes): Promise<void>;
  /** Takes effect after the file in flight. */
  cancel(): void;
  /** Clears the summary of a finished batch. */
  dismiss(): void;
}

type Read = { bytes: Uint8Array } | { error: unknown };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Imports sources one at a time: each is read (the next one while the current one parses),
 * parsed in the worker, skipped when its bytes are already in the library, else written and
 * added. A failure of one file is recorded and the batch goes on.
 */
export function createImporter(deps: ImporterDeps): Importer {
  const store = create<ImportProgress>()(idle);
  let queue: ImportSource[] = [];
  let running: Promise<void> | undefined;
  let cancelled = false;

  const update = (change: (state: ImportProgress) => Partial<ImportProgress>) => {
    store.setState(change);
  };

  const run = async () => {
    let parser = deps.createParser();
    let index = 0;
    let prefetched: { index: number; read: Promise<Read> } | undefined;
    let pendingRows: SongRow[] = [];
    let flushed = deps.now();

    const flush = (force: boolean) => {
      if (pendingRows.length === 0 || (!force && deps.now() - flushed < FLUSH_MS)) return;
      const rows = pendingRows;
      pendingRows = [];
      flushed = deps.now();
      deps.onAdded(rows);
    };
    const readOf = (at: number): Promise<Read> => {
      const source = queue[at];
      if (!source) return Promise.resolve({ error: new Error('No such file') });
      return source.read().then(
        (bytes): Read => ({ bytes }),
        (error: unknown): Read => ({ error }),
      );
    };
    const fail = (name: string, message: string) => {
      update((state) => ({ failed: [...state.failed, { name, message }] }));
    };

    const importOne = async (source: ImportSource, bytes: Uint8Array) => {
      let outcome;
      try {
        // A copy, because the worker takes the buffer and the original is written to the library.
        outcome = await parser.parse(bytes.slice(), stem(source.name));
      } catch (error) {
        // A dead worker fails every later call; the next file gets a fresh one.
        parser.dispose();
        parser = deps.createParser();
        fail(source.name, messageOf(error));
        return;
      }
      if (!outcome.ok) {
        fail(source.name, outcome.message);
        return;
      }
      const { parsed } = outcome;
      if (await deps.repo.byKey(parsed.key)) {
        update((state) => ({ duplicates: state.duplicates + 1 }));
        return;
      }
      const row = newSongRow({
        id: newId(),
        name: source.name,
        format: parsed.format,
        key: parsed.key,
        meta: parsed.meta,
        now: deps.now(),
      });
      try {
        await deps.files.write(row, parsed.native, bytes);
        await deps.repo.add(row);
      } catch (error) {
        await deps.files.discard(row);
        // Another import (an open that imports) may have added the same bytes in the meantime.
        if (await deps.repo.byKey(parsed.key)) {
          update((state) => ({ duplicates: state.duplicates + 1 }));
        } else {
          fail(source.name, messageOf(error));
        }
        return;
      }
      pendingRows.push(row);
      update((state) => ({ imported: state.imported + 1 }));
    };

    try {
      while (index < queue.length && !cancelled) {
        const source = queue[index];
        if (!source) break;
        update(() => ({ current: source.name }));
        if (source.size > MAX_FILE_BYTES) {
          fail(
            source.name,
            `The file is ${String(Math.ceil(source.size / MB))} MB; the limit is ${String(Math.floor(MAX_FILE_BYTES / MB))} MB`,
          );
        } else {
          const read = await (prefetched?.index === index ? prefetched.read : readOf(index));
          prefetched = undefined;
          // The next file is read while this one parses and writes.
          const following = queue[index + 1];
          if (following && following.size <= MAX_FILE_BYTES) {
            prefetched = { index: index + 1, read: readOf(index + 1) };
          }
          if ('error' in read) fail(source.name, messageOf(read.error));
          else await importOne(source, read.bytes);
        }
        index += 1;
        update(() => ({ done: index }));
        flush(false);
      }
    } finally {
      parser.dispose();
      flush(true);
      queue = [];
      running = undefined;
      update(() => ({ phase: 'done', current: undefined, cancelled }));
      cancelled = false;
    }
  };

  return {
    store,
    add(sources, notes = {}) {
      const wanted = sources.filter((source) => formatOfExtension(source.name) !== undefined);
      if (running === undefined) {
        queue = [...wanted];
        cancelled = false;
        store.setState({
          ...idle(),
          phase: 'running',
          total: wanted.length,
          skipped: sources.length - wanted.length,
          truncated: notes.truncated === true,
          unreadableFolders: notes.unreadableFolders ?? 0,
        });
        // Not `run()` directly: a batch with nothing to do finishes before this line returns.
        running = Promise.resolve().then(run);
      } else {
        queue.push(...wanted);
        update((state) => ({
          total: state.total + wanted.length,
          skipped: state.skipped + sources.length - wanted.length,
          truncated: state.truncated || notes.truncated === true,
          unreadableFolders: state.unreadableFolders + (notes.unreadableFolders ?? 0),
        }));
      }
      return running;
    },
    cancel() {
      if (running !== undefined) cancelled = true;
    },
    dismiss() {
      if (running === undefined) store.setState(idle());
    },
  };
}
