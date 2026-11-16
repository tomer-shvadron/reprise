import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  EventChannel,
  EventChannels,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  RepriseBridge,
} from '@reprise/web';

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  // Electron types every reply as any; main's handler for C is typed to return InvokeResult<C>.
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;
}

function on<C extends EventChannel>(
  channel: C,
  listener: (...args: EventChannels[C]) => void,
): () => void {
  const forward = (_event: IpcRendererEvent, ...args: EventChannels[C]) => {
    listener(...args);
  };
  ipcRenderer.on(channel, forward);
  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

// The page world calls these through contextBridge with whatever it likes, so arguments are
// checked here as well as in main. Main is told the document is edited only while a close
// listener is subscribed: with nobody to answer, holding the close would trap the user.
let edited = false;
let closeListeners = 0;

function reportEdited(): Promise<undefined> {
  return invoke('window:set-edited', edited && closeListeners > 0);
}

function setDocumentEdited(value: boolean): Promise<undefined> {
  if (typeof value !== 'boolean') return Promise.reject(new TypeError('Expected a boolean'));
  edited = value;
  return reportEdited();
}

function confirmClose(close: boolean): Promise<undefined> {
  if (typeof close !== 'boolean') return Promise.reject(new TypeError('Expected a boolean'));
  return invoke('window:close', close);
}

function onCloseRequest(listener: () => void): () => void {
  const off = on('window:close-requested', listener);
  closeListeners += 1;
  if (closeListeners === 1 && edited) void reportEdited();
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    off();
    closeListeners -= 1;
    if (closeListeners === 0 && edited) void reportEdited();
  };
}

const bridge: RepriseBridge = {
  openFile: (filters) => invoke('file:open', filters),
  saveFile: (suggestedName, bytes, filters) => invoke('file:save', suggestedName, bytes, filters),
  readFile: (path, range) => (range ? invoke('file:read', path, range) : invoke('file:read', path)),
  writeFile: (path, bytes) => invoke('file:write', path, bytes),
  openFiles: (filters) => invoke('file:open-many', filters),
  openFolder: (filters) => invoke('folder:open', filters),
  mkdir: (path) => invoke('storage:mkdir', path),
  listDir: (path) => invoke('storage:list', path),
  move: (from, to) => invoke('storage:move', from, to),
  remove: (path) => invoke('storage:remove', path),
  setRecentSongs: (items) => invoke('menu:set-recent', items),
  setHistoryLabels: (labels) => invoke('menu:set-history', labels),
  startDownload: (id, url, to, sha256, maxBytes) =>
    invoke('download:start', id, url, to, sha256, maxBytes),
  cancelDownload: (id) => invoke('download:cancel', id),
  onDownloadProgress: (listener) => on('download:progress', listener),
  libraryDir: () => invoke('app:library-dir'),
  dataDir: () => invoke('app:data-dir'),
  print: (options) => (options ? invoke('app:print', options) : invoke('app:print')),
  setDocumentEdited,
  confirmClose,
  onCloseRequest,
  onMenuCommand: (listener) => on('menu:command', listener),
  onOpenRecent: (listener) => on('menu:open-recent', listener),
};

contextBridge.exposeInMainWorld('reprise', bridge);
