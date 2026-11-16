import { newId, type Id } from '@reprise/model';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';
import { restoreTrackSession } from '@/features/tracks';
import type { FileHandle } from '@/platform/platform';
import { contentKey, SCORE_FILES, type Saver } from '@/state/document';

import { createSongsRepository, type SongsRepository } from './db/repository';
import type { SongRow } from './db/rows';
import { openLibraryDb, type RepriseDb } from './db/schema';
import { createLibraryFiles, type LibraryFiles } from './files';
import { createImporter, type Importer } from './import/importer';
import { createParser, type Parser } from './import/parser';
import { persistDocument } from './import/persist-document';
import { startDraftKeeper, type DraftKeeper } from './drafts/draft-keeper';
import { draftNativePath, draftSidecarPath } from './drafts/draft-paths';
import { createDraftRecovery, type DraftRecovery } from './drafts/recovery';
import { stem } from './import/song-row';
import { fromPicked, resolveDrop, type DropSnapshot, type ImportSource } from './import/sources';
import {
  createExporter,
  createExportPromptStore,
  type ExportPromptStore,
} from './save/export-flow';
import { createLibrarySaver } from './save/save-flow';
import { entryOf, isSortKey, type LibraryEntry, type SortKey } from './search';
import { startSessionKeeper, type SessionKeeper } from './session-keeper';

const SORT_SETTING = 'library.sort';

/** How long a Save waits for the import of the file just opened before it goes to Save As. */
export const IMPORT_WAIT_MS = 5000;

export interface LibraryState {
  entries: LibraryEntry[];
  loaded: boolean;
  query: string;
  sort: SortKey;
  /** The last failure to load the list or open a song, for the screen to show. */
  error: string | undefined;
  /** The last failure to import the open document, for the "not in your library" banner only. */
  bannerError: string | undefined;
  /**
   * The document id of an open file the library holds the original bytes of but has not imported:
   * the one state the "Not in your library" banner shows for.
   */
  unimportedId: Id | undefined;
  /** A short, non-blocking message about a save or an export, until dismissed. */
  notice: LibraryNotice | undefined;
}

export interface LibraryNotice {
  kind: 'info' | 'error';
  message: string;
}

export interface Library {
  db: RepriseDb;
  store: UseBoundStore<StoreApi<LibraryState>>;
  repo: SongsRepository;
  /** Reads the rows and the saved sort into the store. */
  load(): Promise<void>;
  setQuery(query: string): void;
  setSort(sort: SortKey): void;
  /** Opens the song in the player with its track session restored, never marking it modified. */
  openSong(id: Id, options?: OpenSongOptions): Promise<void>;
  /**
   * `openSong` after the unsaved-changes question, for every entry the user starts. Resolves when
   * the song is open, or when the user cancels the question.
   */
  requestOpenSong(id: Id): Promise<void>;
  /** The library's Save and Save As, which `installLibrary` gives the document store. */
  saver: Saver;
  /** File > Export as Guitar Pro: writes a `.gp` copy; never a save. */
  exportGuitarPro(): Promise<void>;
  /** The question the export dialog is asking, if any. */
  exportPrompt: ExportPromptStore;
  dismissNotice(): void;
  drafts: Drafts;
  /** The progress of the running or last batch import. */
  importer: Importer;
  /** One dialog for several files, imported as a batch. */
  importFiles(): Promise<void>;
  /** A folder and everything below it, imported as a batch. */
  importFolder(): Promise<void>;
  /** Files or folders dropped on the window, imported as a batch. */
  importDrop(drop: DropSnapshot): Promise<void>;
  importSources(sources: readonly ImportSource[]): Promise<void>;
  /**
   * Opens a file exactly as `document.openBytes` does, then imports it in the background from
   * the open score. A file already in the library opens as that song instead.
   */
  openAndImport(file: OpenedBytes): Promise<void>;
  /** `file.open`: the platform's picker, then `openAndImport`. */
  openFile(): Promise<void>;
  /** Opens a file without importing it; the banner offers to import it afterwards. */
  openWithoutImport(file: OpenedBytes): Promise<void>;
  openFileWithoutImport(): Promise<void>;
  /** Imports the open document, which `openWithoutImport` left out of the library. */
  importOpenDocument(): Promise<void>;
  /** Moves the song's files to the trash, then removes its row. */
  deleteSong(id: Id): Promise<void>;
  /** Shows the library sorted by last opened, for the recent-songs command. */
  showRecent(): void;
  dispose(): Promise<void>;
}

export interface OpenSongOptions {
  /** Open these bytes (a recovered draft) instead of the song's file, as unsaved. */
  bytes?: Uint8Array;
  modified?: boolean;
}

/** The open document's autosave and what the next launch offers back. */
export interface Drafts {
  recovery: DraftRecovery;
  /** Starts keeping drafts; returns the undo. `installLibrary` calls it. */
  start(): () => void;
  /** Removes the open document's draft, after a Don't save that closes the window. */
  discardOpen(): Promise<void>;
}

export interface OpenedBytes {
  name: string;
  bytes: Uint8Array;
  handle?: FileHandle;
}

export interface LibraryOptions {
  db?: RepriseDb;
  now?: () => number;
  files?: LibraryFiles;
  createParser?: () => Parser;
}

export function createLibrary(
  services: Pick<AppServices, 'document' | 'playback' | 'selection' | 'audio' | 'platform' | 'ui'>,
  options: LibraryOptions = {},
): Library {
  const db = options.db ?? openLibraryDb();
  const now = options.now ?? Date.now;
  const repo = createSongsRepository(db);
  const files = options.files ?? createLibraryFiles(services.platform);
  const parserOf = options.createParser ?? createParser;
  const store = create<LibraryState>()(() => ({
    entries: [],
    loaded: false,
    query: '',
    sort: 'title',
    error: undefined,
    bannerError: undefined,
    unimportedId: undefined,
    notice: undefined,
  }));
  let keeper: SessionKeeper | undefined;
  let keeperId: Id | undefined;
  let opening = 0;
  // The bytes of a file opened without importing, so the banner can still copy the original.
  let held: { documentId: Id | undefined; name: string; bytes: Uint8Array } | undefined;
  const hold = (next: typeof held) => {
    held = next;
    store.setState({ unimportedId: next?.documentId });
  };

  let previousId = services.document.getState().id;
  // Any other document, a new song included, releases the bytes of an unimported file.
  services.document.subscribe((state) => {
    if (held && held.documentId !== state.id) hold(undefined);
    // A notice about the last document (why its Save became Save As) is stale on another.
    if (state.id !== previousId) store.setState({ bannerError: undefined, notice: undefined });
    previousId = state.id;
  });

  const replaceRow = (row: SongRow) => {
    store.setState((state) => ({
      entries: state.entries.map((entry) => (entry.row.id === row.id ? entryOf(row) : entry)),
    }));
  };

  const startKeeper = (id: Id) => {
    void keeper?.stop();
    keeperId = id;
    keeper = startSessionKeeper(services, id, (songId, session) =>
      repo.setSession(songId, session),
    );
  };

  // Rows added or removed while a `load()` is reading, so its snapshot never undoes them.
  const loads = new Set<{ added: Set<Id>; removed: Set<Id> }>();

  const addEntries = (rows: SongRow[]) => {
    for (const load of loads) {
      for (const row of rows) {
        load.added.add(row.id);
        load.removed.delete(row.id);
      }
    }
    store.setState((state) => {
      // An upsert: a row the database already gave a load may still be flushed by a batch.
      const incoming = new Map(rows.map((row) => [row.id, entryOf(row)]));
      const kept = state.entries.map((entry) => incoming.get(entry.row.id) ?? entry);
      const known = new Set(state.entries.map((entry) => entry.row.id));
      return { entries: [...kept, ...[...incoming.values()].filter((e) => !known.has(e.row.id))] };
    });
  };

  const notify = (message: string, kind: 'info' | 'error' = 'info') => {
    store.setState({ notice: { kind, message } });
  };
  const exportPrompt = createExportPromptStore();
  const saver = createLibrarySaver({
    document: services.document,
    repo,
    files,
    now,
    onAdded: (row) => {
      addEntries([row]);
    },
    onUpdated: replaceRow,
    onJoined: startKeeper,
    settled: (id) => importSettled(id),
    clearNotice: () => {
      if (store.getState().notice?.kind === 'info') store.setState({ notice: undefined });
    },
    notify,
  });
  const exportGuitarPro = createExporter({
    document: services.document,
    platform: services.platform,
    repo,
    promptStore: exportPrompt,
    onUpdated: replaceRow,
    notify,
  });

  const importer = createImporter({
    repo,
    files,
    createParser: parserOf,
    now,
    onAdded: addEntries,
  });

  const failure = (prefix: string, error: unknown) => {
    store.setState({
      error: `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
    });
  };

  const runBatch = (
    pick: () => Promise<
      { sources: ImportSource[]; truncated?: boolean; unreadable?: number } | undefined
    >,
  ) =>
    track(
      (async () => {
        let picked;
        try {
          picked = await pick();
        } catch (error) {
          failure('Could not read the files', error);
          return;
        }
        if (!picked || picked.sources.length === 0) return;
        await importer.add(picked.sources, {
          ...(picked.truncated && { truncated: true }),
          ...(picked.unreadable && { unreadableFolders: picked.unreadable }),
        });
      })(),
    );

  // Writes that outlive the call that started them: the song's files and row land after the file
  // is open, and a batch writes several steps per file. `dispose` awaits them so it never closes
  // the database under one.
  const pending = new Set<Promise<void>>();
  const track = (write: Promise<void>): Promise<void> => {
    pending.add(write);
    allWrites.add(write);
    const done = () => {
      pending.delete(write);
      allWrites.delete(write);
    };
    write.then(done, done);
    return write;
  };

  // The import of each file just opened, by the song id it was opened with, until it finishes.
  const importsInFlight = new Map<Id, Promise<void>>();
  const importSettled = async (id: Id): Promise<boolean> => {
    const running = importsInFlight.get(id);
    if (!running) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, IMPORT_WAIT_MS);
    });
    try {
      return await Promise.race([running.then(() => true), late]);
    } finally {
      clearTimeout(timer);
    }
  };

  const openAndImport = (file: OpenedBytes): Promise<void> => {
    const songId = newId();
    const run = openAndImportAs(file, songId).finally(() => {
      importsInFlight.delete(songId);
    });
    // Never rejects for a waiter: Save only needs to know when the import is over.
    importsInFlight.set(
      songId,
      run.catch(() => undefined),
    );
    return run;
  };

  const openAndImportAs = async ({ name, bytes, handle }: OpenedBytes, songId: Id) => {
    const { document } = services;
    const token = ++opening;
    // Looked up while the file opens, not before: a first open of the database must not
    // delay the first paint. A duplicate is rare and swaps to the library's copy afterwards.
    const duplicate = contentKey(bytes)
      .then((key) => repo.byKey(key).then((existing) => ({ key, existing })))
      .catch(() => undefined);
    const before = document.getState().id;
    await document.getState().openBytes(name, bytes, {
      ...(handle !== undefined && { handle }),
      songId,
    });
    const opened = document.getState();
    if (opened.songId !== songId || opened.id === before || !opened.score || !opened.file) return;
    const { id: documentId, score, file } = opened;
    hold(undefined);
    store.setState({ bannerError: undefined });
    const found = await duplicate;
    if (token !== opening || document.getState().id !== documentId) return;
    // Swaps to the library's copy, unless the user has edited the file in the meantime.
    const swap = async (existingId: Id): Promise<void> => {
      if (!document.getState().dirty) {
        await library.openSong(existingId);
        return;
      }
      document.getState().setSongId(undefined);
      hold({ documentId, name, bytes });
    };
    if (found?.existing) {
      await swap(found.existing.id);
      return;
    }
    try {
      // The score is cloned to the worker on this thread (about 45 ms for the 8 x 300 bar
      // reference score), so it waits until the first paint is out.
      await afterPaint();
      const row = await persistDocument(
        { repo, files, createParser: parserOf, now },
        { songId, score, name, format: file.format, key: file.key, original: bytes },
      );
      addEntries([row]);
      if (document.getState().id === documentId) startKeeper(songId);
    } catch (error) {
      // The same bytes that another import added first: this document is that song.
      const existing = await repo.byKey(file.key).catch(() => undefined);
      if (existing) {
        if (token === opening && document.getState().id === documentId) await swap(existing.id);
        return;
      }
      if (document.getState().id === documentId) {
        document.getState().setSongId(undefined);
        hold({ documentId, name, bytes });
        store.setState({
          bannerError: `Could not add "${name}" to the library: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  };

  const importOpenDocument = async () => {
    const { document } = services;
    const { id: documentId, score, file, songId } = document.getState();
    if (!score || !file || songId !== undefined) return;
    const bytesHeld = held?.documentId === documentId ? held : undefined;
    if (!bytesHeld) {
      store.setState({
        bannerError: 'The original file is no longer available. Open it again to import it.',
      });
      return;
    }
    if (await repo.byKey(file.key)) {
      store.setState({ bannerError: `"${bytesHeld.name}" is already in your library.` });
      return;
    }
    const newSongId = newId();
    try {
      const row = await persistDocument(
        { repo, files, createParser: parserOf, now },
        {
          songId: newSongId,
          score,
          name: bytesHeld.name,
          format: file.format,
          key: file.key,
          original: bytesHeld.bytes,
        },
      );
      addEntries([row]);
      if (document.getState().id !== documentId) return;
      // After the write, so the keeper's own check of the song id passes from its first session.
      document.getState().setSongId(newSongId);
      hold(undefined);
      store.setState({ bannerError: undefined });
      startKeeper(newSongId);
    } catch (error) {
      store.setState({
        bannerError: `Could not add "${bytesHeld.name}" to the library: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  let draftKeeper: DraftKeeper | undefined;
  const recovery = createDraftRecovery({
    services,
    repo,
    openSong: (id, options) => library.openSong(id, options),
    keeper: () => draftKeeper,
    ready: () => store.getState().loaded && store.getState().error === undefined,
    notify: (message) => {
      notify(message, 'error');
    },
  });
  const drafts: Drafts = {
    recovery,
    start() {
      const started = startDraftKeeper({
        services,
        platform: services.platform,
        createParser: parserOf,
        notify: (message) => {
          notify(message, 'error');
        },
        deferred: (key) => recovery.isDeferred(key),
      });
      draftKeeper = started;
      return () => {
        if (draftKeeper === started) draftKeeper = undefined;
        void started.stop();
      };
    },
    async discardOpen() {
      await draftKeeper?.discard();
    },
  };

  const library: Library = {
    db,
    drafts,
    store,
    repo,
    importer,
    saver,
    exportGuitarPro,
    exportPrompt,
    dismissNotice() {
      store.setState({ notice: undefined });
    },
    requestOpenSong: (id) =>
      new Promise<void>((resolve) => {
        whenSaved(
          services,
          'opening another song',
          () => {
            void library.openSong(id).finally(resolve);
          },
          resolve,
        );
      }),
    async load() {
      const tracker = { added: new Set<Id>(), removed: new Set<Id>() };
      loads.add(tracker);
      try {
        const [rows, sort] = await Promise.all([repo.all(), repo.getSetting(SORT_SETTING)]);
        const merged = new Map(rows.map((row) => [row.id, entryOf(row)]));
        for (const id of tracker.removed) merged.delete(id);
        for (const entry of store.getState().entries) {
          if (tracker.added.has(entry.row.id)) merged.set(entry.row.id, entry);
        }
        store.setState({
          entries: [...merged.values()],
          loaded: true,
          error: undefined,
          ...(isSortKey(sort) && { sort }),
        });
      } catch (error) {
        store.setState({
          loaded: true,
          error: `Could not read the library: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        loads.delete(tracker);
      }
    },
    setQuery(query) {
      store.setState({ query });
    },
    setSort(sort) {
      store.setState({ sort });
      void repo.setSetting(SORT_SETTING, sort).catch((error: unknown) => {
        console.warn('Could not save the library sort', error);
      });
    },
    async openSong(id, { bytes: draft, modified = false } = {}) {
      const token = ++opening;
      const { document, platform, ui } = services;
      try {
        // Flushed first, so a reopen of the song on screen restores what the user just changed.
        // The keeper stops itself, flushing, when the document switches; a failed open leaves it.
        await keeper?.flush();
        const row = await repo.get(id);
        if (!row) {
          store.setState({ error: 'That song is no longer in the library.' });
          return;
        }
        let bytes: Uint8Array;
        try {
          bytes = draft ?? (await platform.readFile(row.nativePath));
        } catch {
          store.setState({
            error: `The file for "${row.title}" is missing from the library folder.`,
          });
          return;
        }
        if (token !== opening) return;
        await document.getState().openBytes(`${stem(row.originalName)}.reprise`, bytes, {
          handle: row.nativePath,
          songId: id,
          ...(modified && { modified }),
        });
        const state = document.getState();
        // A failed read, or another open that overtook this one, leaves a document that is not ours.
        if (token !== opening || state.songId !== id || state.score === undefined) {
          if (state.error) store.setState({ error: state.error.message });
          return;
        }
        store.setState({ error: undefined, bannerError: undefined });
        // The bytes of a file opened without importing belong to that document only.
        hold(undefined);
        // restoreTrackSession only sets the view, the mixer overrides and the current track: none
        // of them moves `dirty` or the history.
        if (row.session) restoreTrackSession(services, row.session);
        startKeeper(id);
        const opened = { ...row, lastOpenedAt: now() };
        replaceRow(opened);
        void repo.touch(id, opened.lastOpenedAt).catch((error: unknown) => {
          console.warn('Could not record the open time', error);
        });
        ui.getState().setScreen('player');
        // A draft the user put off at launch is answered before an edit can overwrite it.
        if (draft === undefined) recovery.reoffer(id);
      } catch (error) {
        store.setState({
          error: `Could not open the song: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    importSources: (sources) => runBatch(() => Promise.resolve({ sources: [...sources] })),
    importFiles: () =>
      runBatch(async () => ({
        sources: (await services.platform.openFiles(SCORE_FILES)).map(fromPicked),
      })),
    importFolder: () =>
      runBatch(async () => {
        const folder = await services.platform.openFolder(SCORE_FILES);
        return (
          folder && {
            sources: folder.files.map(fromPicked),
            truncated: folder.truncated,
            unreadable: folder.skipped,
          }
        );
      }),
    importDrop: (drop) =>
      runBatch(async () => {
        const walk = await resolveDrop(drop);
        return { sources: walk.sources, truncated: walk.truncated, unreadable: walk.skipped };
      }),
    openAndImport: (file) => track(openAndImport(file)),
    async openFile() {
      const picked = await pickOne(services);
      if (picked) await library.openAndImport(picked);
    },
    async openWithoutImport({ name, bytes, handle }) {
      const { document } = services;
      const before = document.getState().id;
      await document.getState().openBytes(name, bytes, handle === undefined ? {} : { handle });
      const opened = document.getState();
      if (opened.id !== before && opened.score) hold({ documentId: opened.id, name, bytes });
    },
    async openFileWithoutImport() {
      const picked = await pickOne(services);
      if (picked) await library.openWithoutImport(picked);
    },
    importOpenDocument: () => track(importOpenDocument()),
    async deleteSong(id) {
      const { document } = services;
      try {
        if (keeperId === id) {
          // Flushed first, so the copy of the row in the trash holds the last session.
          await keeper?.stop();
          keeper = undefined;
          keeperId = undefined;
        }
        const row = await repo.get(id);
        if (row) await files.trash(row);
        await repo.remove(id);
        // Its unsaved changes have nowhere to go back to.
        await Promise.allSettled([
          services.platform.remove(draftNativePath(id)),
          services.platform.remove(draftSidecarPath(id)),
        ]);
        for (const load of loads) {
          load.removed.add(id);
          load.added.delete(id);
        }
        store.setState((state) => ({
          entries: state.entries.filter((entry) => entry.row.id !== id),
        }));
        if (document.getState().songId === id) document.getState().setSongId(undefined);
      } catch (error) {
        failure('Could not delete the song', error);
      }
    },
    showRecent() {
      store.setState({ sort: 'lastOpened', query: '' });
      services.ui.getState().setScreen('library');
    },
    async dispose() {
      await Promise.allSettled([...pending]);
      await keeper?.stop();
      keeper = undefined;
      db.close();
    },
  };
  return library;
}

// Every library's background writes, for `settleLibraryWrites`.
const allWrites = new Set<Promise<void>>();

/**
 * Resolves once every import running now, in any library, has finished: `openAndImport`,
 * `importOpenDocument` and the batch imports. They write after the call that started them has
 * returned, so a test teardown that deletes the databases awaits this first, or a late write
 * lands in the next database opened under the same name. `Library.dispose()` awaits its own
 * library's share. Nothing calls `dispose()` when the window closes and no hook could await it
 * there, so a close mid-import can leave files in the library folder with no row; see the
 * library README.
 */
export async function settleLibraryWrites(): Promise<void> {
  await Promise.allSettled([...allWrites]);
}

/** After the next frame has painted; a hidden tab, which draws no frames, waits at most 200 ms. */
function afterPaint(): Promise<void> {
  const painted = new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
  const limit = new Promise<void>((resolve) => setTimeout(resolve, 200));
  return Promise.race([painted, limit]);
}

async function pickOne(
  services: Pick<AppServices, 'document' | 'platform'>,
): Promise<OpenedBytes | undefined> {
  try {
    return await services.platform.openFile(SCORE_FILES);
  } catch (error) {
    services.document
      .getState()
      .failOpen('the file', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

const libraries = new WeakMap<object, Library>();

/** The one library of an app instance: its database, its store and its session keeper. */
export function libraryOf(services: AppServices): Library {
  const existing = libraries.get(services);
  if (existing) return existing;
  const library = createLibrary(services);
  libraries.set(services, library);
  return library;
}

/** Gives an app instance a library made elsewhere, such as a test's over its own database. */
export function provideLibrary(services: AppServices, library: Library): void {
  libraries.set(services, library);
}
