import type { RepriseBridge } from './bridge';
import { createBrowserPlatform } from './browser-platform';
import { createElectronPlatform } from './electron-platform';
import type { Platform } from './platform';

declare global {
  interface Window {
    /** Set by the Electron preload script; absent in a plain browser. */
    reprise?: RepriseBridge;
  }
}

export function selectPlatform(win: Window): Platform {
  return win.reprise ? createElectronPlatform(win.reprise, win) : createBrowserPlatform(win);
}

let current: Platform | undefined;

/** The platform for this process, chosen once from whether the preload bridge is present. */
export function platform(): Platform {
  current ??= selectPlatform(window);
  return current;
}
