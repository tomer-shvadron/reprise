import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  session,
  shell,
  systemPreferences,
  type FileFilter as DialogFilter,
  type IpcMainInvokeEvent,
} from 'electron';

import type { FileFilter, MenuCommandId } from '@reprise/web';

import { registerInvokeHandlers, sendEvent } from './ipc';
import { menuTemplate } from './menu';
import { PathAccess } from './path-access';
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
const RENDERER_HTML = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];

const libraryDir = join(app.getPath('music'), 'Reprise');
const dataDir = app.getPath('userData');
const windowStateFile = join(dataDir, 'window-state.json');
const access = new PathAccess([libraryDir, dataDir]);

const dialogFilters = (filters: readonly FileFilter[]): DialogFilter[] =>
  filters.map(({ name, extensions }) => ({ name, extensions: [...extensions] }));

function assertAccess(path: string): void {
  if (!access.allows(path)) throw new Error(`Access to ${path} was not granted`);
}

function isTrusted(event: IpcMainInvokeEvent): boolean {
  return (
    BrowserWindow.fromWebContents(event.sender) !== null &&
    event.senderFrame === event.sender.mainFrame
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
      const path = result.filePaths[0];
      if (result.canceled || path === undefined) return undefined;
      access.grant(path);
      return { name: basename(path), bytes: await readFile(path) };
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
    'file:read': async (_event, path) => {
      assertAccess(path);
      return readFile(path);
    },
    'file:write': async (_event, path, bytes) => {
      assertAccess(path);
      await writeFile(path, bytes);
      return undefined;
    },
    'app:library-dir': () => Promise.resolve(libraryDir),
    'app:data-dir': () => Promise.resolve(dataDir),
    'app:print': (event) =>
      new Promise((resolve, reject) => {
        event.sender.print({}, (success, reason) => {
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

function restrictNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
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
  restrictNavigation(window);

  if (RENDERER_URL) await window.loadURL(RENDERER_URL);
  else await window.loadFile(RENDERER_HTML);
  return window;
}

function allowMicrophoneOnly(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const audioOnly =
      permission === 'media' &&
      'mediaTypes' in details &&
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
  allowMicrophoneOnly();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        isMac: process.platform === 'darwin',
        isPackaged: app.isPackaged,
        docsUrl: DOCS_URL,
        sendCommand: sendMenuCommand,
        openExternal: (url) => void shell.openExternal(url),
      }),
    ),
  );
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

start().catch((error: unknown) => {
  console.error('Reprise failed to start', error);
  app.exit(1);
});
