/**
 * The contract between the Electron renderer and main process. Preload and main import these
 * types from `@reprise/web` so a channel exists only once it is declared here.
 */

export interface FileFilter {
  name: string;
  /** Without the leading dot. */
  extensions: readonly string[];
}

/**
 * Opaque to the app: whatever lets the platform write over a file it opened, a path in Electron
 * and a `FileSystemFileHandle` in a browser with the File System Access API.
 */
export type FileHandle = unknown;

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Pass it back to `Platform.writeHandle` to save in place; absent when the platform cannot. */
  handle?: FileHandle;
}

/** A file the user picked, or one a picked folder held; the bytes are read on demand. */
export interface PickedFile {
  name: string;
  /** '/'-separated path inside the picked folder; equal to `name` for a file picked alone. */
  relativePath: string;
  size: number;
  /** The whole file, or `range`'s bytes; a range past the end returns the bytes that exist. */
  read(range?: ReadRange): Promise<Uint8Array>;
}

/** A byte range of a file: non-negative safe integers, `length` at most `MAX_READ_LENGTH`. */
export interface ReadRange {
  offset: number;
  length: number;
}

/** The most bytes one ranged read returns; main refuses a longer `length`, and so does the browser. */
export const MAX_READ_LENGTH = 16 * 1024 * 1024;

/** What `Platform.download` asks main for; `to` is a root-relative path under `data/sounds/`. */
export interface DownloadRequest {
  /** `https:` only, and so is every redirect it follows. */
  url: string;
  to: string;
  /** Lower- or upper-case hex; the file is kept only when its SHA-256 matches. */
  sha256: string;
  /** The download is refused past this many bytes; main clamps it to `MAX_DOWNLOAD_BYTES`. */
  maxBytes: number;
  /** Throttled by main; `total` is absent when the server sent no Content-Length. */
  onProgress?: (loaded: number, total?: number) => void;
  /** Aborting it cancels the download and removes the partial file. */
  signal?: AbortSignal;
}

/** The hard cap on one download, applied by main whatever `maxBytes` says. */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export interface PickedFolder {
  name: string;
  files: PickedFile[];
  /** True when the walk stopped at `PICKED_FOLDER_LIMITS`: the folder holds more than `files`. */
  truncated: boolean;
  /** Folders below the picked one that could not be read (permissions) and were left out. */
  skipped: number;
}

/** What a folder walk stops at, so a pick of a drive root cannot hang the app or flood IPC. */
export const PICKED_FOLDER_LIMITS = {
  maxFiles: 10_000,
  maxDepth: 16,
  /** Every entry looked at, matching or not, so a pick of a home folder ends in bounded time. */
  maxEntries: 100_000,
} as const;

/**
 * The first segment of a path given to `mkdir`, `listDir`, `move` and `remove`: it names the
 * root the rest is relative to, `libraryDir()` or `dataDir()`.
 */
export const STORAGE_ROOTS = ['library', 'data'] as const;
export type StorageRoot = (typeof STORAGE_ROOTS)[number];

export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

/** A song for the native File menu's Open Recent list. */
export interface RecentSong {
  id: string;
  title: string;
}

/**
 * What the native Edit menu's Undo and Redo read: the newest step's command name on each stack.
 * An absent entry means that stack is empty, so main disables the item.
 */
export interface HistoryMenuLabels {
  undo?: string;
  redo?: string;
}

/** The most Open Recent entries a platform shows; main caps the list at this. */
export const MAX_RECENT_SONGS = 10;

/** A picked file as main describes it: `path` is the granted absolute path `file:read` takes. */
export interface PickedFileInfo {
  name: string;
  relativePath: string;
  size: number;
  path: string;
}

export interface PickedFolderInfo {
  name: string;
  files: PickedFileInfo[];
  truncated: boolean;
  skipped: number;
}

/** The paper the system print dialog opens on; the browser reads the print's `@page` size instead. */
export interface PrintOptions {
  pageSize: 'A4' | 'Letter';
}

/** Renderer-to-main request channels: the renderer invokes, main handles and replies. */
export interface InvokeChannels {
  'file:open': { args: [filters: readonly FileFilter[]]; result: OpenedFile | undefined };
  'file:save': {
    args: [suggestedName: string, bytes: Uint8Array, filters: readonly FileFilter[]];
    result: string | undefined;
  };
  'file:read': { args: [path: string, range?: ReadRange]; result: Uint8Array };
  'file:write': { args: [path: string, bytes: Uint8Array]; result: undefined };
  'file:open-many': { args: [filters: readonly FileFilter[]]; result: PickedFileInfo[] };
  'folder:open': {
    args: [filters: readonly FileFilter[]];
    result: PickedFolderInfo | undefined;
  };
  'storage:mkdir': { args: [path: string]; result: undefined };
  'storage:list': { args: [path: string]; result: DirEntry[] };
  'storage:move': { args: [from: string, to: string]; result: undefined };
  'storage:remove': { args: [path: string]; result: undefined };
  'menu:set-recent': { args: [items: readonly RecentSong[]]; result: undefined };
  'menu:set-history': { args: [labels: HistoryMenuLabels]; result: undefined };
  'menu:set-keys': { args: [keys: MenuKeys]; result: undefined };
  'menu:set-checked': { args: [checked: MenuChecks]; result: undefined };
  'app:library-dir': { args: []; result: string };
  'app:data-dir': { args: []; result: string };
  'app:print': { args: [options?: PrintOptions]; result: undefined };
  /**
   * Desktop only. `id` is the renderer's own, one per download in flight; main refuses one
   * already in use. Resolves the size once the file is in place, and rejects (leaving no file)
   * on a refused URL or path, a hash mismatch, an oversize body, an error or a cancel.
   */
  'download:start': {
    args: [id: string, url: string, to: string, sha256: string, maxBytes: number];
    result: { size: number };
  };
  /** Cancels the download with this id; nothing happens when there is none. */
  'download:cancel': { args: [id: string]; result: undefined };
  /** The renderer reports whether the open document has unsaved changes; main keys the close guard on it. */
  'window:set-edited': { args: [edited: boolean]; result: undefined };
  /**
   * The renderer answers a close request: `true` once it saved or discarded, so main closes now
   * (and quits, for a Quit); `false` for Cancel, which ends the request. Ignored with none open.
   */
  'window:close': { args: [close: boolean]; result: undefined };
}

export type InvokeChannel = keyof InvokeChannels;
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];

/** Commands the native menu can trigger; each id is a command in the renderer's registry. */
export const MENU_COMMAND_IDS = [
  'app.settings',
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.export',
  'file.exportAsciiTab',
  'file.exportImage',
  'file.print',
  'edit.undo',
  'edit.redo',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.toggleTheme',
  'view.toggleSidebar',
  'view.togglePanel',
  'view.toggleViewMode',
  'transport.playPause',
  'transport.stop',
  'transport.playFromStart',
  'transport.playFromSelection',
  'transport.toggleLoop',
  'transport.loopSelection',
  'transport.toggleCountIn',
  'transport.toggleMetronome',
  'transport.metronomeVolume',
  'transport.setTempo',
  'transport.slowDown',
  'transport.speedUp',
  'transport.toggleSpeed',
  'transport.toggleFixedTempo',
  'transport.masterVolume',
] as const;

export type MenuCommandId = (typeof MENU_COMMAND_IDS)[number];

/**
 * A key for a menu item, as the renderer's registry has it (the `Shortcut` shape without `only`).
 * `key` is one printable ASCII character or a name such as `F4`, `Enter`, `ArrowUp`.
 */
export interface MenuKey {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** The key of each menu command; `null` or absent leaves the item without one. */
export type MenuKeys = Partial<Record<MenuCommandId, MenuKey | null>>;

/** The state of each checkbox item in the native menu; an id the menu has no checkbox for is refused. */
export type MenuChecks = Partial<Record<MenuCommandId, boolean>>;

/** Main-to-renderer event channels and their payloads. */
export interface EventChannels {
  /**
   * `viaAccelerator` is true when the item's key, not a click, ran it: the renderer then leaves
   * a key that has no Cmd or Ctrl to a focused text field, as it does for its own keys.
   */
  'menu:command': [id: MenuCommandId, viaAccelerator?: boolean];
  'menu:open-recent': [id: string];
  /** The user asked to close the window while the document is edited; answer with `window:close`. */
  'window:close-requested': [];
  /** Progress of the download `id`, throttled; always sent once more when the body ends. */
  'download:progress': [id: string, loaded: number, total?: number];
}

export type EventChannel = keyof EventChannels;

/**
 * What preload exposes as `window.reprise`. Members are function properties, not methods:
 * contextBridge copies them as free functions, so nothing may rely on `this`.
 */
export interface RepriseBridge {
  openFile: (...args: InvokeArgs<'file:open'>) => Promise<InvokeResult<'file:open'>>;
  saveFile: (...args: InvokeArgs<'file:save'>) => Promise<InvokeResult<'file:save'>>;
  readFile: (...args: InvokeArgs<'file:read'>) => Promise<InvokeResult<'file:read'>>;
  writeFile: (...args: InvokeArgs<'file:write'>) => Promise<InvokeResult<'file:write'>>;
  openFiles: (...args: InvokeArgs<'file:open-many'>) => Promise<InvokeResult<'file:open-many'>>;
  openFolder: (...args: InvokeArgs<'folder:open'>) => Promise<InvokeResult<'folder:open'>>;
  mkdir: (...args: InvokeArgs<'storage:mkdir'>) => Promise<InvokeResult<'storage:mkdir'>>;
  listDir: (...args: InvokeArgs<'storage:list'>) => Promise<InvokeResult<'storage:list'>>;
  move: (...args: InvokeArgs<'storage:move'>) => Promise<InvokeResult<'storage:move'>>;
  remove: (...args: InvokeArgs<'storage:remove'>) => Promise<InvokeResult<'storage:remove'>>;
  setRecentSongs: (
    ...args: InvokeArgs<'menu:set-recent'>
  ) => Promise<InvokeResult<'menu:set-recent'>>;
  setHistoryLabels: (
    ...args: InvokeArgs<'menu:set-history'>
  ) => Promise<InvokeResult<'menu:set-history'>>;
  setMenuKeys: (...args: InvokeArgs<'menu:set-keys'>) => Promise<InvokeResult<'menu:set-keys'>>;
  setMenuChecks: (
    ...args: InvokeArgs<'menu:set-checked'>
  ) => Promise<InvokeResult<'menu:set-checked'>>;
  libraryDir: () => Promise<InvokeResult<'app:library-dir'>>;
  dataDir: () => Promise<InvokeResult<'app:data-dir'>>;
  print: (...args: InvokeArgs<'app:print'>) => Promise<InvokeResult<'app:print'>>;
  setDocumentEdited: (
    ...args: InvokeArgs<'window:set-edited'>
  ) => Promise<InvokeResult<'window:set-edited'>>;
  confirmClose: (...args: InvokeArgs<'window:close'>) => Promise<InvokeResult<'window:close'>>;
  startDownload: (...args: InvokeArgs<'download:start'>) => Promise<InvokeResult<'download:start'>>;
  cancelDownload: (
    ...args: InvokeArgs<'download:cancel'>
  ) => Promise<InvokeResult<'download:cancel'>>;
  /** Returns an unsubscribe function. */
  onDownloadProgress: (
    listener: (...args: EventChannels['download:progress']) => void,
  ) => () => void;
  /** Returns an unsubscribe function. */
  onMenuCommand: (listener: (...args: EventChannels['menu:command']) => void) => () => void;
  onOpenRecent: (listener: (...args: EventChannels['menu:open-recent']) => void) => () => void;
  onCloseRequest: (
    listener: (...args: EventChannels['window:close-requested']) => void,
  ) => () => void;
}
