import type { MenuItemConstructorOptions } from 'electron';

import type { MenuCommandId } from '@reprise/web';

interface MenuCommand {
  label: string;
  /** Mirrors the renderer's shortcut for the same command, which the menu shows and owns. */
  accelerator?: string;
}

export const MENU_COMMANDS = {
  'file.open': { label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  'file.save': { label: 'Save', accelerator: 'CmdOrCtrl+S' },
  'file.saveAs': { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
  'file.print': { label: 'Print…', accelerator: 'CmdOrCtrl+P' },
  'view.zoomIn': { label: 'Zoom In', accelerator: 'CmdOrCtrl+=' },
  'view.zoomOut': { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-' },
  'view.zoomReset': { label: 'Actual Size', accelerator: 'CmdOrCtrl+0' },
  'view.toggleTheme': { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+L' },
  'view.toggleSidebar': { label: 'Toggle Tracks' },
  'view.togglePanel': { label: 'Toggle Panel' },
} satisfies Record<MenuCommandId, MenuCommand>;

export interface MenuOptions {
  isMac: boolean;
  isPackaged: boolean;
  docsUrl: string;
  sendCommand: (id: MenuCommandId) => void;
  openExternal: (url: string) => void;
}

export function menuTemplate({
  isMac,
  isPackaged,
  docsUrl,
  sendCommand,
  openExternal,
}: MenuOptions): MenuItemConstructorOptions[] {
  const command = (id: MenuCommandId): MenuItemConstructorOptions => ({
    ...MENU_COMMANDS[id],
    click: () => {
      sendCommand(id);
    },
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };

  return [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        command('file.open'),
        separator,
        command('file.save'),
        command('file.saveAs'),
        separator,
        command('file.print'),
        // macOS keeps Quit in the application menu.
        ...(isMac ? [] : [separator, { role: 'quit' } as const]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        separator,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        command('view.zoomIn'),
        command('view.zoomOut'),
        command('view.zoomReset'),
        separator,
        command('view.toggleTheme'),
        command('view.toggleSidebar'),
        command('view.togglePanel'),
        ...(isPackaged ? [] : [separator, { role: 'toggleDevTools' } as const]),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Reprise Documentation',
          click: () => {
            openExternal(docsUrl);
          },
        },
      ],
    },
  ];
}
