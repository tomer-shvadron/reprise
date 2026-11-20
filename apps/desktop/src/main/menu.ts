import type { MenuItemConstructorOptions } from 'electron';

import type { HistoryMenuLabels, MenuCommandId, MenuKey, MenuKeys, RecentSong } from '@reprise/web';

interface MenuCommand {
  label: string;
}

/**
 * The commands the menu offers, by label only: the renderer sends the keys (`menu:set-keys`),
 * from the same registry that handles them, so the menu has no list of its own to keep in step.
 */
export const MENU_COMMANDS = {
  'app.settings': { label: 'Settings…' },
  'file.new': { label: 'New Song' },
  'file.open': { label: 'Open…' },
  'file.save': { label: 'Save' },
  'file.saveAs': { label: 'Save As…' },
  'file.export': { label: 'Export as Guitar Pro…' },
  'file.print': { label: 'Print…' },
  // The renderer replays a focused text field's own undo, so these replace the native roles.
  'edit.undo': { label: 'Undo' },
  'edit.redo': { label: 'Redo' },
  'view.zoomIn': { label: 'Zoom In' },
  'view.zoomOut': { label: 'Zoom Out' },
  'view.zoomReset': { label: 'Actual Size' },
  'view.toggleTheme': { label: 'Toggle Theme' },
  'view.toggleSidebar': { label: 'Toggle Tracks' },
  'view.togglePanel': { label: 'Toggle Mixer' },
  'view.toggleViewMode': { label: 'Toggle Page and Continuous View' },
} satisfies Record<MenuCommandId, MenuCommand>;

const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  '+': 'Plus',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
};

/**
 * The Electron accelerator for a key. Shift is dropped for a punctuation character, which already
 * implies it, as the renderer's own key labels do.
 */
export function acceleratorOf({ key, mod, shift, alt }: MenuKey): string {
  const named = key.length > 1 || /^[a-z\d ]$/i.test(key);
  return [
    mod && 'CmdOrCtrl',
    alt && 'Alt',
    shift && named && 'Shift',
    ACCELERATOR_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key),
  ]
    .filter(Boolean)
    .join('+');
}

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
  /** The key of each command, from the renderer; an item has none until it sends them. */
  keys?: MenuKeys;
}

const acceleratorProp = (key: MenuKey | null | undefined) =>
  key ? { accelerator: acceleratorOf(key) } : {};

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
  keys = {},
}: MenuOptions): MenuItemConstructorOptions[] {
  const command = (id: MenuCommandId): MenuItemConstructorOptions => ({
    label: MENU_COMMANDS[id].label,
    ...acceleratorProp(keys[id]),
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
    ...(isMac
      ? [
          {
            // The role supplies the app name as the label; the given submenu replaces its items
            // to add Settings… under About, where macOS apps keep Preferences.
            role: 'appMenu',
            submenu: [
              { role: 'about' },
              separator,
              command('app.settings'),
              separator,
              { role: 'services' },
              separator,
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              separator,
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
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
        // macOS keeps Settings… and Quit in the application menu.
        ...(isMac
          ? []
          : [separator, command('app.settings'), separator, { role: 'quit' } as const]),
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
