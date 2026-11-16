import { CloseGuard } from './close-guard';

/** The slices of Electron's `BrowserWindow` and its `webContents` the guard listens to. */
export interface WindowEvents {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
}

export interface ContentsEvents {
  on(
    event: 'render-process-gone' | 'unresponsive' | 'responsive' | 'did-navigate',
    listener: () => void,
  ): unknown;
}

export interface GuardedWindow {
  events: WindowEvents;
  contents: ContentsEvents;
  isDestroyed(): boolean;
  close(): void;
  setDocumentEdited(edited: boolean): void;
}

export interface CloseWiringPorts {
  /** Sends `window:close-requested` to the window's renderer. */
  ask(): void;
  quit(): void;
  /** Called once the window is gone, to drop the guard from the registry. */
  forget(): void;
}

/**
 * Holds a close of an edited document until the renderer answers. No `beforeunload` is involved:
 * Electron cancels a close silently when one is registered, so the renderer is asked over IPC.
 */
export function wireCloseGuard(window: GuardedWindow, ports: CloseWiringPorts): CloseGuard {
  const guard = new CloseGuard({
    ask: () => {
      if (!window.isDestroyed()) ports.ask();
    },
    closeWindow: () => {
      if (!window.isDestroyed()) window.close();
    },
    quitApp: () => {
      ports.quit();
    },
  });
  window.events.on('close', (event) => {
    if (guard.onClose()) event.preventDefault();
  });
  window.events.on('closed', () => {
    guard.markDestroyed();
    ports.forget();
  });
  window.contents.on('render-process-gone', () => {
    guard.markRendererGone();
  });
  window.contents.on('unresponsive', () => {
    guard.markUnresponsive(true);
  });
  window.contents.on('responsive', () => {
    guard.markUnresponsive(false);
  });
  // Only a committed navigation: one that `will-navigate` then blocks leaves the page, and its
  // unsaved document, where it was. The new page has reported nothing, and a crashed renderer
  // that was reloaded is alive again.
  window.contents.on('did-navigate', () => {
    guard.reset();
    window.setDocumentEdited(false);
  });
  return guard;
}

/**
 * `before-quit`: Quit does not go through a window's close button, so it is held here the same
 * way. Any window that holds the answer back keeps the app open; every guard is asked, so each
 * edited window shows its own question.
 */
export function holdQuit(guards: Iterable<CloseGuard>, event: { preventDefault(): void }): void {
  for (const guard of guards) {
    if (guard.onBeforeQuit()) event.preventDefault();
  }
}
