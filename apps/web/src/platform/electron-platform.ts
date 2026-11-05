import type { RepriseBridge } from './bridge';
import { requestMicrophone } from './browser-platform';
import type { Platform } from './platform';

export function createElectronPlatform(bridge: RepriseBridge, win: Window = window): Platform {
  return {
    openFile: (filters) => bridge.openFile(filters),
    saveFile: (suggestedName, bytes, filters) => bridge.saveFile(suggestedName, bytes, filters),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, bytes) => bridge.writeFile(path, bytes),
    libraryDir: () => bridge.libraryDir(),
    dataDir: () => bridge.dataDir(),
    print: () => bridge.print(),
    // getUserMedia works in the renderer; main only grants the permission.
    microphone: () => requestMicrophone(win),
  };
}
