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
  type MessageBoxOptions,
} from 'electron';

import type {
  FileFilter,
  HistoryMenuLabels,
  MenuCommandId,
  MenuKeys,
  RecentSong,
} from '@reprise/web';

import { APP_INDEX_URL, APP_SCHEME, createAppProtocolHandler } from './app-protocol';
import { isAppUrl } from './app-url';
import { CloseGuard } from './close-guard';
import { holdQuit, wireCloseGuard } from './close-wiring';
import { createDownloadManager } from './download';
import { electronGet } from './electron-http';
import { readPath, writePath } from './file-io';
import { registerInvokeHandlers, sendEvent } from './ipc';
import { decidePermission } from './permission';
import { aboutDetail, aboutPanelOptions } from './about';
import { menuTemplate } from './menu';
import { openedFile } from './opened-file';
import { PathAccess } from './path-access';
import { describePickedFile, walkFolder } from './pick-folder';
import { profilePaths } from './profile';
import {
  listDirIn,
  mkdirIn,
  moveIn,
  removeIn,
  sweepTempFiles,
  type StorageRoots,
} from './storage-fs';
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

// Before ready (it throws after), so it stays above every await in this module. It sandboxes every
// renderer whatever its webPreferences say, so nodeIntegration cannot come back by accident.
app.enableSandbox();

// Before ready, so it stays above every await in this module.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Before anything reads a path: a run under REPRISE_PROFILE_DIR (the smoke test) keeps all of its
// state in that folder and leaves the user's own profile and library alone.
const profile = profilePaths(process.env);
if (profile) {
  app.setPath('userData', profile.userData);
  // A stray export must not pass silently: the real library would look empty.
  console.error(`Using profile ${profile.userData} and ${profile.library} (REPRISE_PROFILE_DIR)`);
}

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
// Undefined until the renderer reports: the Edit menu then keeps plain, enabled Undo and Redo.
let historyLabels: HistoryMenuLabels | undefined;
// App-wide preferences, so unlike the history labels they outlive the window.
let menuKeys: MenuKeys | undefined;
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

const downloads = createDownloadManager({ roots: storageRoots, get: electronGet });

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
    'file:read': (_event, path, range) => readPath(path, access, storageRoots, range),
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
    'window:close': (event, close) => {
      closeGuards.get(ownerWindow(event))?.answer(close);
      return Promise.resolve(undefined);
    },
    'menu:set-recent': (_event, items) => {
      recentSongs = items;
      applyMenu();
      return Promise.resolve(undefined);
    },
    'menu:set-history': (_event, labels) => {
      historyLabels = labels;
      applyMenu();
      return Promise.resolve(undefined);
    },
    'menu:set-keys': (_event, keys) => {
      menuKeys = keys;
      applyMenu();
      return Promise.resolve(undefined);
    },
    'download:start': async (event, id, url, to, sha256, maxBytes) => {
      const contents = event.sender;
      const owner = contents.id;
      // The window closing or reloading ends its downloads: nobody is left to answer them.
      const abandon = () => {
        downloads.cancel(owner, id);
      };
      contents.once('destroyed', abandon);
      contents.once('did-navigate', abandon);
      try {
        return await downloads.start({
          owner,
          id,
          url,
          to,
          sha256,
          maxBytes,
          onProgress: (loaded, total) => {
            if (!contents.isDestroyed()) {
              sendEvent(
                contents,
                'download:progress',
                id,
                loaded,
                ...(total === undefined ? [] : [total]),
              );
            }
          },
        });
      } finally {
        contents.removeListener('destroyed', abandon);
        contents.removeListener('did-navigate', abandon);
      }
    },
    'download:cancel': (event, id) => {
      downloads.cancel(event.sender.id, id);
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

function showAbout(): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: MessageBoxOptions = {
    type: 'info',
    title: 'About Reprise',
    message: 'Reprise',
    detail: aboutDetail(app.getVersion(), process.versions),
    buttons: ['OK'],
  };
  void (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
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
        showAbout,
        recent: recentSongs,
        ...(historyLabels && { history: historyLabels }),
        ...(menuKeys && { keys: menuKeys }),
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

function guardClose(window: BrowserWindow): void {
  const guard = wireCloseGuard(
    {
      events: window,
      contents: window.webContents,
      isDestroyed: () => window.isDestroyed(),
      close: () => {
        window.close();
      },
      setDocumentEdited: (edited) => {
        window.setDocumentEdited(edited);
      },
    },
    {
      ask: () => {
        sendEvent(window.webContents, 'window:close-requested');
      },
      quit: () => {
        app.quit();
      },
      forget: () => {
        closeGuards.delete(window);
      },
    },
  );
  closeGuards.set(window, guard);
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

// The microphone and the clipboard write, to the app's own top frame; see `permission.ts`.
function allowAppPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const media = 'mediaTypes' in details ? details : undefined;
    void decidePermission(
      permission,
      {
        mediaTypes: media?.mediaTypes,
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
      },
      {
        platform: process.platform,
        isAppUrl: (url) => isAppUrl(APP_URL, url),
        askForMicrophone: () => systemPreferences.askForMediaAccess('microphone'),
      },
    ).then(callback);
  });
}

async function start(): Promise<void> {
  await app.whenReady();
  await mkdir(libraryDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  // Off the startup path: a library can be large, and the sweep is housekeeping.
  void sweepTempFiles(storageRoots).catch((error: unknown) => {
    console.error('Could not sweep leftover temp files', error);
  });
  protocol.handle(
    APP_SCHEME,
    createAppProtocolHandler(RENDERER_DIR, { contentSecurityPolicy: __REPRISE_CSP__ }),
  );
  allowAppPermissions();
  app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()));
  applyMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

app.on('before-quit', (event) => {
  holdQuit(closeGuards.values(), event);
});

app.on('window-all-closed', () => {
  // No window left to act on, so the Edit menu goes back to plain Undo and Redo (macOS keeps running).
  historyLabels = undefined;
  if (process.platform === 'darwin') applyMenu();
  if (process.platform !== 'darwin') app.quit();
});

start().catch((error: unknown) => {
  console.error('Reprise failed to start', error);
  app.exit(1);
});
