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

const bridge: RepriseBridge = {
  openFile: (filters) => invoke('file:open', filters),
  saveFile: (suggestedName, bytes, filters) => invoke('file:save', suggestedName, bytes, filters),
  readFile: (path) => invoke('file:read', path),
  writeFile: (path, bytes) => invoke('file:write', path, bytes),
  openFiles: (filters) => invoke('file:open-many', filters),
  openFolder: (filters) => invoke('folder:open', filters),
  mkdir: (path) => invoke('storage:mkdir', path),
  listDir: (path) => invoke('storage:list', path),
  move: (from, to) => invoke('storage:move', from, to),
  remove: (path) => invoke('storage:remove', path),
  setRecentSongs: (items) => invoke('menu:set-recent', items),
  libraryDir: () => invoke('app:library-dir'),
  dataDir: () => invoke('app:data-dir'),
  print: (options) => (options ? invoke('app:print', options) : invoke('app:print')),
  onMenuCommand: (listener) => on('menu:command', listener),
  onOpenRecent: (listener) => on('menu:open-recent', listener),
};

contextBridge.exposeInMainWorld('reprise', bridge);
