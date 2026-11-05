/**
 * The contract between the Electron renderer and main process. Preload and main import these
 * types from `@reprise/web` so a channel exists only once it is declared here.
 */

export interface FileFilter {
  name: string;
  /** Without the leading dot. */
  extensions: readonly string[];
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
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
  'app:library-dir': { args: []; result: string };
  'app:data-dir': { args: []; result: string };
  'app:print': { args: []; result: undefined };
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
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomReset'
  | 'view.toggleTheme'
  | 'view.toggleSidebar'
  | 'view.togglePanel';

/** Main-to-renderer event channels and their payloads. */
export interface EventChannels {
  'menu:command': [id: MenuCommandId];
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
  libraryDir: () => Promise<InvokeResult<'app:library-dir'>>;
  dataDir: () => Promise<InvokeResult<'app:data-dir'>>;
  print: () => Promise<InvokeResult<'app:print'>>;
  /** Returns an unsubscribe function. */
  onMenuCommand: (listener: (...args: EventChannels['menu:command']) => void) => () => void;
}
