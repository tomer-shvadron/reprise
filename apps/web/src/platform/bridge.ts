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
  read(): Promise<Uint8Array>;
}

export interface PickedFolder {
  name: string;
  files: PickedFile[];
  /** True when the walk stopped at `PICKED_FOLDER_LIMITS`: the folder holds more than `files`. */
  truncated: boolean;
}

/** What a folder walk stops at, so a pick of a drive root cannot hang the app or flood IPC. */
export const PICKED_FOLDER_LIMITS = { maxFiles: 10_000, maxDepth: 16 } as const;

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
  'file:read': { args: [path: string]; result: Uint8Array };
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
  'app:library-dir': { args: []; result: string };
  'app:data-dir': { args: []; result: string };
  'app:print': { args: [options?: PrintOptions]; result: undefined };
}

export type InvokeChannel = keyof InvokeChannels;
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result'];

/** Commands the native menu can trigger; each id is a command in the renderer's registry. */
export type MenuCommandId =
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.print'
  | 'edit.undo'
  | 'edit.redo'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomReset'
  | 'view.toggleTheme'
  | 'view.toggleSidebar'
  | 'view.togglePanel'
  | 'view.toggleViewMode';

/** Main-to-renderer event channels and their payloads. */
export interface EventChannels {
  'menu:command': [id: MenuCommandId];
  'menu:open-recent': [id: string];
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
  libraryDir: () => Promise<InvokeResult<'app:library-dir'>>;
  dataDir: () => Promise<InvokeResult<'app:data-dir'>>;
  print: (...args: InvokeArgs<'app:print'>) => Promise<InvokeResult<'app:print'>>;
  /** Returns an unsubscribe function. */
  onMenuCommand: (listener: (...args: EventChannels['menu:command']) => void) => () => void;
  onOpenRecent: (listener: (...args: EventChannels['menu:open-recent']) => void) => () => void;
}
