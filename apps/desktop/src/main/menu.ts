import type { MenuItemConstructorOptions } from 'electron';

import type {
  HistoryMenuLabels,
  MenuChecks,
  MenuCommandId,
  MenuKey,
  MenuKeys,
  RecentSong,
} from '@reprise/web';

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
  // The labels of the File > Export submenu's items; the submenu's own title is in the template.
  'file.export': { label: 'Guitar Pro…' },
  'file.exportAsciiTab': { label: 'ASCII Tab…' },
  'file.exportImage': { label: 'Image…' },
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
  'transport.playPause': { label: 'Play/Pause' },
  'transport.stop': { label: 'Stop' },
  'transport.playFromStart': { label: 'Play from Start' },
  'transport.playFromSelection': { label: 'Play from Selection' },
  // The four checkbox items; their state comes from the renderer (`menu:set-checked`).
  'transport.toggleLoop': { label: 'Loop' },
  'transport.loopSelection': { label: 'Loop Selection' },
  'transport.toggleCountIn': { label: 'Count-in' },
  'transport.toggleMetronome': { label: 'Metronome' },
  'transport.metronomeVolume': { label: 'Metronome Volume…' },
  'transport.setTempo': { label: 'Set Tempo…' },
  // The steps name the unit of the mode (see `FIXED_STEP_LABELS`).
  'transport.slowDown': { label: 'Slow Down 5%' },
  'transport.speedUp': { label: 'Speed Up 5%' },
  'transport.toggleSpeed': { label: 'Toggle Relative Speed' },
  'transport.toggleFixedTempo': { label: 'Fixed Tempo' },
  'transport.masterVolume': { label: 'Master Volume…' },
} satisfies Record<MenuCommandId, MenuCommand>;

/** The step items' labels while Fixed Tempo is on: the keys then step the BPM, not the percent. */
const FIXED_STEP_LABELS: Partial<Record<MenuCommandId, string>> = {
  'transport.slowDown': 'Slow Down 5 BPM',
  'transport.speedUp': 'Speed Up 5 BPM',
};

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
  /** `viaAccelerator` is passed (true) only when the item's key ran it, not a click. */
  sendCommand: (id: MenuCommandId, viaAccelerator?: boolean) => void;
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
  /** The state of the checkbox items, from the renderer; an item is unchecked until it sends it. */
  checked?: MenuChecks;
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
  checked = {},
}: MenuOptions): MenuItemConstructorOptions[] {
  const command = (id: MenuCommandId): MenuItemConstructorOptions => ({
    label: MENU_COMMANDS[id].label,
    ...acceleratorProp(keys[id]),
    // Electron says whether the key or a click ran the item; a test may press it with no event.
    click: (_item, _window, event?: { triggeredByAccelerator?: boolean }) => {
      if (event?.triggeredByAccelerator) sendCommand(id, true);
      else sendCommand(id);
    },
  });
  // The native item flips itself on a click; the renderer's push right after sets the truth.
  const checkbox = (id: MenuCommandId): MenuItemConstructorOptions => ({
    ...command(id),
    type: 'checkbox',
    checked: checked[id] === true,
  });
  const fixed = checked['transport.toggleFixedTempo'] === true;
  const step = (id: 'transport.slowDown' | 'transport.speedUp'): MenuItemConstructorOptions => ({
    ...command(id),
    ...(fixed && { label: FIXED_STEP_LABELS[id] ?? MENU_COMMANDS[id].label }),
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

  const exportMenu: MenuItemConstructorOptions = {
    label: 'Export',
    submenu: [command('file.export'), command('file.exportAsciiTab'), command('file.exportImage')],
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
        exportMenu,
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
    {
      label: 'Playback',
      submenu: [
        command('transport.playPause'),
        command('transport.stop'),
        command('transport.playFromStart'),
        command('transport.playFromSelection'),
        separator,
        checkbox('transport.toggleLoop'),
        command('transport.loopSelection'),
        separator,
        checkbox('transport.toggleCountIn'),
        checkbox('transport.toggleMetronome'),
        command('transport.metronomeVolume'),
        separator,
        command('transport.setTempo'),
        step('transport.slowDown'),
        step('transport.speedUp'),
        command('transport.toggleSpeed'),
        checkbox('transport.toggleFixedTempo'),
        separator,
        command('transport.masterVolume'),
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
