import type {
  DirEntry,
  FileFilter,
  FileHandle,
  HistoryMenuLabels,
  OpenedFile,
  PickedFile,
  PickedFolder,
  PrintOptions,
  RecentSong,
} from './bridge';

export type {
  DirEntry,
  FileFilter,
  FileHandle,
  HistoryMenuLabels,
  OpenedFile,
  PickedFile,
  PickedFolder,
  PrintOptions,
  RecentSong,
  StorageRoot,
} from './bridge';
export { MAX_RECENT_SONGS, PICKED_FOLDER_LIMITS, STORAGE_ROOTS } from './bridge';

export interface Platform {
  /** Resolves undefined when the user cancels. */
  openFile(filters: readonly FileFilter[]): Promise<OpenedFile | undefined>;
  /**
   * Resolves a path `writeFile` can write to again, or undefined when the user cancels or the
   * platform cannot name one (a browser download).
   */
  saveFile(
    suggestedName: string,
    bytes: Uint8Array,
    filters: readonly FileFilter[],
  ): Promise<string | undefined>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Writes over a file `openFile` returned the handle of, or a path `saveFile` returned. */
  writeHandle(handle: FileHandle, bytes: Uint8Array): Promise<void>;
  /** Several files in one dialog; [] when the user cancels. */
  openFiles(filters: readonly FileFilter[]): Promise<PickedFile[]>;
  /**
   * A folder, walked recursively and filtered by extension; dot entries and symlinks are skipped.
   * Resolves undefined when the user cancels. A walk past `PICKED_FOLDER_LIMITS` sets `truncated`.
   */
  openFolder(filters: readonly FileFilter[]): Promise<PickedFolder | undefined>;
  /**
   * Paths in the app's own roots are root-relative, with the root named by the first segment:
   * `library/songs/a.reprise`, `data/trash`. That spelling is canonical: the four storage calls
   * below take only it, and `readFile`, `writeFile` and a string `writeHandle` take it too (store
   * it, not an absolute path). Absolute paths, `..`, symlinks and names Windows tools cannot open
   * are rejected; on desktop main checks them, never the renderer. `libraryDir()` and
   * `dataDir()` are for display; an absolute path is only for a file the user picked or saved.
   */
  /** Recursive and idempotent. */
  mkdir(path: string): Promise<void>;
  /** Entries of a directory, sorted by name; [] when it does not exist. */
  listDir(path: string): Promise<DirEntry[]>;
  /** A file or a directory; creates `to`'s parent and rejects when `to` exists. */
  move(from: string, to: string): Promise<void>;
  /** A file or a directory tree; nothing happens when it does not exist. */
  remove(path: string): Promise<void>;
  /** Desktop only: the native File menu's Open Recent list, at most `MAX_RECENT_SONGS`. */
  setRecentSongs?(items: readonly RecentSong[]): void;
  /**
   * Desktop only: the newest undo and redo step names, for the native Edit menu ("Undo <label>");
   * an absent entry disables the item. Best effort, like the recent list.
   */
  setHistoryLabels?(labels: HistoryMenuLabels): void;
  /** Desktop only: a pick from Open Recent. Returns an unsubscribe function. */
  onOpenRecent?(listener: (id: string) => void): () => void;
  /**
   * Desktop only: whether the open document has unsaved changes. Main closes the window without
   * asking while this is false, and sets the macOS edited dot while it is true. Call it on every
   * change of the modified state; a document that is replaced or closed reports false. The
   * bridge reports true to main only while an `onCloseRequest` listener is subscribed, so a page
   * with nobody to answer never holds the window open.
   */
  setDocumentEdited?(edited: boolean): void;
  /**
   * Desktop only: the user asked to close the window (the close button, or Quit) while
   * `setDocumentEdited(true)` stands. The listener asks the user, then answers with
   * `confirmClose(true)` to go ahead or `confirmClose(false)` for Cancel. A request main sent
   * again while the dialog is open (a second Quit) must be treated as a no-op. Returns an
   * unsubscribe function. The window never shows a `beforeunload` prompt on desktop: Electron
   * cancels such a close silently.
   */
  onCloseRequest?(listener: () => void): () => void;
  /**
   * Desktop only: answers the open close request. `true` closes the window now, and quits when
   * the request came from Quit; `false` cancels the request. Ignored when none is open.
   */
  confirmClose?(close: boolean): void;
  /** ~/Music/Reprise on desktop; a directory in origin-private storage in the browser. */
  libraryDir(): Promise<string>;
  /** Electron userData on desktop; a directory in origin-private storage in the browser. */
  dataDir(): Promise<string>;
  /** Opens the system print dialog, on `options.pageSize` where the platform can preselect it. */
  print(options?: PrintOptions): Promise<void>;
  microphone(): Promise<MediaStream>;
}
