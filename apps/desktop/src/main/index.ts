import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  type FileFilter as DialogFilter,
  type IpcMainInvokeEvent,
} from 'electron';

import type { FileFilter, MenuCommandId, RecentSong } from '@reprise/web';

import { APP_INDEX_URL, APP_SCHEME, createAppProtocolHandler } from './app-protocol';
import { isAppUrl } from './app-url';
import { CloseGuard } from './close-guard';
import { readPath, writePath } from './file-io';
import { registerInvokeHandlers, sendEvent } from './ipc';
import { menuTemplate } from './menu';
import { openedFile } from './opened-file';
import { PathAccess } from './path-access';
import { describePickedFile, walkFolder } from './pick-folder';
import { profilePaths } from './profile';
import { listDirIn, mkdirIn, moveIn, removeIn, type StorageRoots } from './storage-fs';
import {
  DEFAULT_WINDOW_STATE,
  fitToDisplays,
  MIN_WINDOW_SIZE,
  readWindowState,
  writeWindowState,
  type WindowState,
} from './window-state';

const DOCS_URL = 'https://github.com/tomer-shvadron/reprise/tree/main/docs';
const PRELOAD = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const RENDERER_DIR = fileURLToPath(new URL('../renderer/', import.meta.url));
// Only a development build follows the dev server; a shipped app must not be pointed elsewhere.
const RENDERER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const APP_URL = RENDERER_URL ?? APP_INDEX_URL;

// Before ready, so it stays above every await in this module.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Before anything reads a path: a run under REPRISE_PROFILE_DIR (the smoke test) keeps all of its
// state in that folder and leaves the user's own profile and library alone.
const profile = profilePaths(process.env);
if (profile) app.setPath('userData', profile.userData);

const libraryDir = profile?.library ?? join(app.getPath('music'), 'Reprise');
// The app's own files get a folder of their own: userData is also Chromium's profile (IndexedDB,
// Local Storage, cookies), which no renderer call may reach.
const userDataDir = app.getPath('userData');
const dataDir = join(userDataDir, 'files');
const windowStateFile = join(userDataDir, 'window-state.json');
// Only files the user picked or saved in a dialog; the roots are reached by root-relative paths.
const access = new PathAccess();
const storageRoots: StorageRoots = { library: libraryDir, data: dataDir };
let recentSongs: readonly RecentSong[] = [];
const closeGuards = new Map<BrowserWindow, CloseGuard>();

const dialogFilters = (filters: readonly FileFilter[]): DialogFilter[] =>
  filters.map(({ name, extensions }) => ({ name, extensions: [...extensions] }));

function isTrusted(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    frame !== null &&
    frame === event.sender.mainFrame &&
    isAppUrl(APP_URL, frame.url) &&
    BrowserWindow.fromWebContents(event.sender) !== null
  );
}

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error('IPC from a webContents without a window');
  return window;
}

registerInvokeHandlers(
  {
    'file:open': async (event, filters) => {
      const result = await dialog.showOpenDialog(ownerWindow(event), {
        properties: ['openFile'],
        filters: dialogFilters(filters),
      });
      return openedFile(result, access, (path) => readFile(path));
    },
    'file:save': async (event, suggestedName, bytes, filters) => {
      const result = await dialog.showSaveDialog(ownerWindow(event), {
        defaultPath: join(app.getPath('documents'), suggestedName),
        filters: dialogFilters(filters),
      });
      if (result.canceled || result.filePath === '') return undefined;
      await writeFile(result.filePath, bytes);
      access.grant(result.filePath);
      return result.filePath;
    },
    'file:read': (_event, path) => readPath(path, access, storageRoots),
    'file:write': async (_event, path, bytes) => {
      await writePath(path, bytes, access, storageRoots);
      return undefined;
    },
    'file:open-many': async (event, filters) => {
      const result = await dialog.showOpenDialog(ownerWindow(event), {
        properties: ['openFile', 'multiSelections'],
        filters: dialogFilters(filters),
      });
      if (result.canceled) return [];
      return Promise.all(
        result.filePaths.map(async (path) => {
          // Read-only: an import never writes back to the user's own files.
          access.grantRead(path);
          return describePickedFile(path);
        }),
      );
    },
    'folder:open': async (event, filters) => {
      const result = await dialog.showOpenDialog(ownerWindow(event), {
        properties: ['openDirectory'],
      });
      const [dir] = result.filePaths;
      if (result.canceled || dir === undefined) return undefined;
      const folder = await walkFolder(dir, filters);
      // Each file is granted read-only so the page can import it later; the folder itself is not.
      for (const file of folder.files) access.grantRead(file.path);
      return folder;
    },
    'storage:mkdir': async (_event, path) => {
      await mkdirIn(storageRoots, path);
      return undefined;
    },
    'storage:list': (_event, path) => listDirIn(storageRoots, path),
    'storage:move': async (_event, from, to) => {
      await moveIn(storageRoots, from, to);
      return undefined;
    },
    'storage:remove': async (_event, path) => {
      await removeIn(storageRoots, path);
      return undefined;
    },
    'window:set-edited': (event, edited) => {
      const window = ownerWindow(event);
      closeGuards.get(window)?.setEdited(edited);
      // macOS draws a dot in the close button; the call does nothing elsewhere.
      window.setDocumentEdited(edited);
      return Promise.resolve(undefined);
    },
    'window:close': (event) => {
      closeGuards.get(ownerWindow(event))?.confirm();
      return Promise.resolve(undefined);
    },
    'menu:set-recent': (_event, items) => {
      recentSongs = items;
      applyMenu();
      return Promise.resolve(undefined);
    },
    'app:library-dir': () => Promise.resolve(libraryDir),
    'app:data-dir': () => Promise.resolve(dataDir),
    'app:print': (event, options) =>
      new Promise((resolve, reject) => {
        // The page box is the whole sheet and carries its own margins; the paper is ours too.
        const print = {
          printBackground: false,
          margins: { marginType: 'none' as const },
          ...(options && { pageSize: options.pageSize }),
        };
        event.sender.print(print, (success, reason) => {
          if (success || reason === 'cancelled') resolve(undefined);
          else reject(new Error(`Printing failed: ${reason}`));
        });
      }),
  },
  isTrusted,
);

function sendMenuCommand(id: MenuCommandId): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (window) sendEvent(window.webContents, 'menu:command', id);
}

function sendOpenRecent(id: string): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (window) sendEvent(window.webContents, 'menu:open-recent', id);
}

function applyMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        isMac: process.platform === 'darwin',
        isPackaged: app.isPackaged,
        docsUrl: DOCS_URL,
        sendCommand: sendMenuCommand,
        openExternal: (url) => void shell.openExternal(url),
        recent: recentSongs,
        openRecent: sendOpenRecent,
      }),
    ),
  );
}

function persistWindowState(window: BrowserWindow): void {
  const { x, y, width, height } = window.getNormalBounds();
  const state: WindowState = { position: { x, y }, width, height, maximized: window.isMaximized() };
  try {
    writeWindowState(windowStateFile, state);
  } catch (error) {
    console.error('Could not save the window state', error);
  }
}

function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      persistWindowState(window);
    }, 500);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    persistWindowState(window);
  });
}

/**
 * Holds a close of an edited document until the renderer answers. No `beforeunload` is involved:
 * Electron cancels a close silently when one is registered, so the renderer is asked over IPC.
 */
function guardClose(window: BrowserWindow): void {
  const { webContents } = window;
  const guard = new CloseGuard({
    ask: () => {
      if (!window.isDestroyed()) sendEvent(webContents, 'window:close-requested');
    },
    closeWindow: () => {
      if (!window.isDestroyed()) window.close();
    },
    quitApp: () => {
      app.quit();
    },
  });
  closeGuards.set(window, guard);
  window.on('close', (event) => {
    if (guard.onClose()) event.preventDefault();
  });
  window.on('closed', () => {
    guard.markDestroyed();
    closeGuards.delete(window);
  });
  webContents.on('render-process-gone', () => {
    guard.markRendererGone();
  });
  webContents.on('unresponsive', () => {
    guard.markUnresponsive(true);
  });
  webContents.on('responsive', () => {
    guard.markUnresponsive(false);
  });
  // A page that navigates away starts unreported; the new one reports for itself.
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) guard.setEdited(false);
  });
}

function restrictNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(APP_URL, url)) event.preventDefault();
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const saved = readWindowState(windowStateFile) ?? DEFAULT_WINDOW_STATE;
  const state = fitToDisplays(
    saved,
    screen.getAllDisplays().map(({ workArea }) => workArea),
  );
  const window = new BrowserWindow({
    ...state.position,
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    title: 'Reprise',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.maximized) window.maximize();
  window.once('ready-to-show', () => {
    window.show();
  });
  trackWindowState(window);
  guardClose(window);
  restrictNavigation(window);

  await window.loadURL(APP_URL);
  return window;
}

function allowMicrophoneOnly(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const audioOnly =
      permission === 'media' &&
      'mediaTypes' in details &&
      details.mediaTypes.length > 0 &&
      details.mediaTypes.every((type) => type === 'audio');
    if (!audioOnly) {
      callback(false);
      return;
    }
    if (process.platform !== 'darwin') {
      callback(true);
      return;
    }
    systemPreferences.askForMediaAccess('microphone').then(callback, () => {
      callback(false);
    });
  });
}

async function start(): Promise<void> {
  await app.whenReady();
  await mkdir(libraryDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  protocol.handle(APP_SCHEME, createAppProtocolHandler(RENDERER_DIR));
  allowMicrophoneOnly();
  applyMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

// Quit (the menu, Cmd+Q, the dock) does not go through a window's close button, so it is held
// here the same way. Any window that holds the answer back keeps the app open.
app.on('before-quit', (event) => {
  for (const guard of closeGuards.values()) {
    if (guard.onBeforeQuit()) event.preventDefault();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

start().catch((error: unknown) => {
  console.error('Reprise failed to start', error);
  app.exit(1);
});
