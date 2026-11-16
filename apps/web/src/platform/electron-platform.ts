import type { PickedFileInfo, RepriseBridge } from './bridge';
import { requestMicrophone } from './browser-platform';
import type { Platform } from './platform';

// Main granted every picked path when the dialog returned it, so a read needs no further check.
const toPickedFile = (bridge: RepriseBridge, info: PickedFileInfo) => ({
  name: info.name,
  relativePath: info.relativePath,
  size: info.size,
  read: () => bridge.readFile(info.path),
});

export function createElectronPlatform(bridge: RepriseBridge, win: Window = window): Platform {
  return {
    openFile: (filters) => bridge.openFile(filters),
    saveFile: (suggestedName, bytes, filters) => bridge.saveFile(suggestedName, bytes, filters),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    // Main hands out the picked path as the handle and has already granted it.
    writeHandle: (handle, bytes) =>
      typeof handle === 'string'
        ? bridge.writeFile(handle, bytes)
        : Promise.reject(new Error('Not a file handle this platform issued')),
    openFiles: async (filters) =>
      (await bridge.openFiles(filters)).map((info) => toPickedFile(bridge, info)),
    openFolder: async (filters) => {
      const folder = await bridge.openFolder(filters);
      return (
        folder && {
          name: folder.name,
          truncated: folder.truncated,
          skipped: folder.skipped,
          files: folder.files.map((info) => toPickedFile(bridge, info)),
        }
      );
    },
    mkdir: (path) => bridge.mkdir(path),
    listDir: (path) => bridge.listDir(path),
    move: (from, to) => bridge.move(from, to),
    remove: (path) => bridge.remove(path),
    setRecentSongs: (items) => {
      // The menu is a convenience: a failed refresh must not break the caller.
      bridge.setRecentSongs(items).catch((error: unknown) => {
        console.error('Could not update the Open Recent menu', error);
      });
    },
    onOpenRecent: (listener) => bridge.onOpenRecent(listener),
    // Best effort, like the menu: a failed report leaves main on its last known state.
    setDocumentEdited: (edited) => {
      bridge.setDocumentEdited(edited).catch((error: unknown) => {
        console.error('Could not report the document state', error);
      });
    },
    onCloseRequest: (listener) => bridge.onCloseRequest(listener),
    confirmClose: () => {
      bridge.confirmClose().catch((error: unknown) => {
        console.error('Could not close the window', error);
      });
    },
    libraryDir: () => bridge.libraryDir(),
    dataDir: () => bridge.dataDir(),
    print: (options) => (options ? bridge.print(options) : bridge.print()),
    // getUserMedia works in the renderer; main only grants the permission.
    microphone: () => requestMicrophone(win),
  };
}
