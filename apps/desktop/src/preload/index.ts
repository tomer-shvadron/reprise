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
  libraryDir: () => invoke('app:library-dir'),
  dataDir: () => invoke('app:data-dir'),
  print: () => invoke('app:print'),
  onMenuCommand: (listener) => on('menu:command', listener),
};

contextBridge.exposeInMainWorld('reprise', bridge);
