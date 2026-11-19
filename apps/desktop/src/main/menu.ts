import type { MenuItemConstructorOptions } from 'electron';

import type { HistoryMenuLabels, MenuCommandId, RecentSong } from '@reprise/web';

interface MenuCommand {
  label: string;
  /** Mirrors the renderer's shortcut for the same command, which the menu shows and owns. */
  accelerator?: string;
}

export const MENU_COMMANDS = {
  'file.new': { label: 'New Song', accelerator: 'CmdOrCtrl+N' },
  'file.open': { label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  'file.save': { label: 'Save', accelerator: 'CmdOrCtrl+S' },
  'file.saveAs': { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
  'file.export': { label: 'Export as Guitar Pro…', accelerator: 'CmdOrCtrl+Shift+E' },
  'file.print': { label: 'Print…', accelerator: 'CmdOrCtrl+P' },
  // The renderer replays a focused text field's own undo, so these replace the native roles.
  'edit.undo': { label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
  'edit.redo': { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z' },
  'view.zoomIn': { label: 'Zoom In', accelerator: 'CmdOrCtrl+=' },
  'view.zoomOut': { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-' },
  'view.zoomReset': { label: 'Actual Size', accelerator: 'CmdOrCtrl+0' },
  'view.toggleTheme': { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+L' },
  'view.toggleSidebar': { label: 'Toggle Tracks' },
  'view.togglePanel': { label: 'Toggle Mixer', accelerator: 'F8' },
  'view.toggleViewMode': { label: 'Toggle Page and Continuous View', accelerator: 'F4' },
} satisfies Record<MenuCommandId, MenuCommand>;

/** "Undo <label>", or the bare name with no label; a lone & is a mnemonic in a Windows label. */
export function historyItemLabel(name: string, label: string | undefined): string {
  return label === undefined ? name : `${name} ${label.replaceAll('&', '&&')}`;
}

export interface MenuOptions {
  isMac: boolean;
  isPackaged: boolean;
  docsUrl: string;
  sendCommand: (id: MenuCommandId) => void;
  openExternal: (url: string) => void;
  /** Shows the About box; macOS has its own entry in the application menu. */
  showAbout?: () => void;
  /** The Open Recent entries, newest first; the list is empty until the renderer sends one. */
  recent?: readonly RecentSong[];
  openRecent?: (id: string) => void;
  /**
   * The newest undo and redo step names; an absent one leaves the plain item. Never disables.
   */
  history?: HistoryMenuLabels;
}

export function menuTemplate({
  isMac,
  isPackaged,
  docsUrl,
  sendCommand,
  openExternal,
  showAbout = () => undefined,
  recent = [],
  openRecent = () => undefined,
  history,
}: MenuOptions): MenuItemConstructorOptions[] {
  const command = (id: MenuCommandId): MenuItemConstructorOptions => ({
    ...MENU_COMMANDS[id],
    click: () => {
      sendCommand(id);
    },
  });
  // Never disabled: a disabled item stops the accelerator reaching a focused text field's own
  // undo (macOS), so an empty stack shows the plain name.
  const historyCommand = (id: 'edit.undo' | 'edit.redo'): MenuItemConstructorOptions => ({
    ...command(id),
    label: historyItemLabel(
      MENU_COMMANDS[id].label,
      history?.[id === 'edit.undo' ? 'undo' : 'redo'],
    ),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };

  const openRecentMenu: MenuItemConstructorOptions = {
    label: 'Open Recent',
    submenu:
      recent.length === 0
        ? [{ label: 'No Recent Songs', enabled: false }]
        : recent.map(({ id, title }) => ({
            // A lone & is a mnemonic marker in a Windows menu label.
            label: title.replaceAll('&', '&&'),
            click: () => {
              openRecent(id);
            },
          })),
  };

  return [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        command('file.new'),
        command('file.open'),
        openRecentMenu,
        separator,
        command('file.save'),
        command('file.saveAs'),
        command('file.export'),
        separator,
        command('file.print'),
        // macOS keeps Quit in the application menu.
        ...(isMac ? [] : [separator, { role: 'quit' } as const]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        historyCommand('edit.undo'),
        historyCommand('edit.redo'),
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
        command('view.toggleViewMode'),
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
        ...(isMac
          ? []
          : [
              separator,
              {
                label: 'About Reprise',
                click: () => {
                  showAbout();
                },
              },
            ]),
      ],
    },
  ];
}
