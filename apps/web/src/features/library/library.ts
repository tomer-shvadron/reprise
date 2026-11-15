import type { Id } from '@reprise/model';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { AppServices } from '@/app/services';
import { restoreTrackSession } from '@/features/tracks';

import { createSongsRepository, type SongsRepository } from './db/repository';
import type { SongRow } from './db/rows';
import { openLibraryDb, type RepriseDb } from './db/schema';
import { entryOf, isSortKey, type LibraryEntry, type SortKey } from './search';
import { startSessionKeeper, type SessionKeeper } from './session-keeper';

const SORT_SETTING = 'library.sort';

export interface LibraryState {
  entries: LibraryEntry[];
  loaded: boolean;
  query: string;
  sort: SortKey;
  /** The last failure to load the list or open a song, for the screen to show. */
  error: string | undefined;
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
  openSong(id: Id): Promise<void>;
  dispose(): Promise<void>;
}

export interface LibraryOptions {
  db?: RepriseDb;
  now?: () => number;
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function createLibrary(
  services: Pick<AppServices, 'document' | 'playback' | 'selection' | 'audio' | 'platform' | 'ui'>,
  options: LibraryOptions = {},
): Library {
  const db = options.db ?? openLibraryDb();
  const now = options.now ?? Date.now;
  const repo = createSongsRepository(db);
  const store = create<LibraryState>()(() => ({
    entries: [],
    loaded: false,
    query: '',
    sort: 'title',
    error: undefined,
  }));
  let keeper: SessionKeeper | undefined;
  let opening = 0;

  const replaceRow = (row: SongRow) => {
    store.setState((state) => ({
      entries: state.entries.map((entry) => (entry.row.id === row.id ? entryOf(row) : entry)),
    }));
  };

  return {
    db,
    store,
    repo,
    async load() {
      try {
        const [rows, sort] = await Promise.all([repo.all(), repo.getSetting(SORT_SETTING)]);
        store.setState({
          entries: rows.map(entryOf),
          loaded: true,
          error: undefined,
          ...(isSortKey(sort) && { sort }),
        });
      } catch (error) {
        store.setState({
          loaded: true,
          error: `Could not read the library: ${error instanceof Error ? error.message : String(error)}`,
        });
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
    async openSong(id) {
      const token = ++opening;
      const { document, platform, ui } = services;
      const row = await repo.get(id);
      if (!row) {
        store.setState({ error: 'That song is no longer in the library.' });
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = await platform.readFile(row.nativePath);
      } catch {
        store.setState({
          error: `The file for "${row.title}" is missing from the library folder.`,
        });
        return;
      }
      if (token !== opening) return;
      await keeper?.stop();
      keeper = undefined;
      await document.getState().openBytes(`${stem(row.originalName)}.reprise`, bytes, {
        handle: row.nativePath,
        songId: id,
      });
      const state = document.getState();
      // A failed read, or another open that overtook this one, leaves a document that is not ours.
      if (token !== opening || state.songId !== id || state.score === undefined) {
        if (state.error) store.setState({ error: state.error.message });
        return;
      }
      store.setState({ error: undefined });
      // restoreTrackSession only sets the view, the mixer overrides and the current track: none of
      // them moves `dirty` or the history.
      if (row.session) restoreTrackSession(services, row.session);
      keeper = startSessionKeeper(services, id, (songId, session) =>
        repo.setSession(songId, session),
      );
      const opened = { ...row, lastOpenedAt: now() };
      replaceRow(opened);
      void repo.touch(id, opened.lastOpenedAt).catch((error: unknown) => {
        console.warn('Could not record the open time', error);
      });
      ui.getState().setScreen('player');
    },
    async dispose() {
      await keeper?.stop();
      keeper = undefined;
      db.close();
    },
  };
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
