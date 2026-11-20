import { startNewSong } from '@/features/editor';
import { libraryOf } from '@/features/library/library';
import type { MenuCommandId } from '@/platform/bridge';
import { THEME_SETTING } from '@/state/app-settings';
import { ZOOM } from '@/state/ui';

import type { Command } from './command-registry';
import { openContextMenuOn } from './context-menu/open-on';
import type { AppServices } from './services';
import { whenSaved } from './when-saved';

const ZOOM_STEP = 0.1;

export type AppCommandId =
  | MenuCommandId
  | 'app.commandPalette'
  | 'app.shortcuts'
  | 'app.shortcutsAlt'
  | 'file.close'
  | 'file.showImportDetails'
  | 'view.followPlayback'
  | 'view.toggleRightPanel'
  | 'app.contextMenu'
  | 'app.contextMenuWindows';

type AppCommand = Command & { id: AppCommandId };

export function appCommands(services: AppServices): AppCommand[] {
  const { ui, print, document, settings } = services;
  const zoomBy = (delta: number) => {
    ui.getState().setZoom(Math.round((ui.getState().zoom + delta) * 10) / 10);
  };

  // The focused element's menu; on the body, the score's, so the key still answers.
  const openFocusedMenu = () => {
    const active = globalThis.document.activeElement;
    const target =
      active && active !== globalThis.document.body
        ? active
        : globalThis.document.querySelector('[role="region"][aria-roledescription="score"]');
    if (target) openContextMenuOn(target);
  };

  return [
    {
      id: 'app.commandPalette',
      title: 'Show command palette',
      shortcut: { key: 'k', mod: true },
      inPalette: false,
      run: () => {
        ui.getState().setPaletteOpen(!ui.getState().paletteOpen);
      },
    },
    {
      id: 'app.shortcuts',
      title: 'Show keyboard shortcuts',
      // `?` is Shift+/ on US and the key itself elsewhere; the dispatcher matches the typed
      // character with Shift held, so a layout that prints `?` without Shift is #242's.
      shortcut: { key: '?', shift: true },
      run: () => {
        ui.getState().setShortcutsOpen(!ui.getState().shortcutsOpen);
      },
    },
    {
      id: 'app.shortcutsAlt',
      title: 'Show keyboard shortcuts',
      // The same action as `?`, for when a text field holds the bare key.
      shortcut: { key: '/', mod: true },
      inPalette: false,
      run: () => {
        ui.getState().setShortcutsOpen(!ui.getState().shortcutsOpen);
      },
    },
    {
      id: 'app.contextMenu',
      title: 'Open context menu',
      // Chromium raises no `contextmenu` event for Shift+F10 on macOS, so the command opens it.
      shortcut: { key: 'F10', shift: true, only: 'mac' },
      run: openFocusedMenu,
    },
    {
      id: 'app.contextMenuWindows',
      title: 'Open context menu',
      // Elsewhere Chromium raises its own keyboard `contextmenu` event: the key is left alone, so
      // the menu does not open twice.
      shortcut: { key: 'F10', shift: true, only: 'other' },
      native: true,
      inPalette: false,
      run: openFocusedMenu,
    },
    {
      id: 'app.settings',
      title: 'Settings…',
      // The comma key is the platform convention on macOS and the one Windows apps borrowed; it
      // matches the typed character, so a layout without a comma there needs #242's remapping.
      shortcut: { key: ',', mod: true },
      run: () => {
        ui.getState().openSettings();
      },
    },
    {
      id: 'file.new',
      title: 'New song',
      shortcut: { key: 'n', mod: true },
      // Asks Save, Don't save or Cancel when the document is modified, then opens an empty song
      // in edit mode (WP-083).
      run: () => {
        startNewSong(services);
      },
    },
    {
      id: 'file.open',
      title: 'Open file…',
      shortcut: { key: 'o', mod: true },
      // Asks Save, Don't save or Cancel first when the document is modified, then opens and
      // imports into the library in the background.
      run: () => {
        whenSaved(services, 'opening another song', () => {
          void libraryOf(services).openFile();
        });
      },
    },
    {
      id: 'file.save',
      title: 'Save',
      shortcut: { key: 's', mod: true },
      run: () => document.getState().save(),
    },
    {
      id: 'file.saveAs',
      title: 'Save as…',
      shortcut: { key: 's', mod: true, shift: true },
      run: () => document.getState().saveAs(),
    },
    {
      id: 'file.export',
      title: 'Export as Guitar Pro…',
      // Writes a .gp copy and changes nothing about the open document; the desktop menu item
      // mirrors the shortcut.
      shortcut: { key: 'e', mod: true, shift: true },
      run: () => libraryOf(services).exportGuitarPro(),
    },
    {
      id: 'file.close',
      title: 'Close file',
      run: () => {
        whenSaved(services, 'closing the song', () => {
          document.getState().close();
        });
      },
    },
    {
      id: 'file.showImportDetails',
      title: 'Show import details',
      run: () => {
        document.getState().showImportDetails();
      },
    },
    {
      id: 'file.print',
      title: 'Print…',
      shortcut: { key: 'p', mod: true },
      run: () => {
        print.getState().open();
      },
    },
    {
      id: 'view.zoomIn',
      title: 'Zoom in',
      shortcut: { key: '=', mod: true },
      run: () => {
        zoomBy(ZOOM_STEP);
      },
    },
    {
      id: 'view.zoomOut',
      title: 'Zoom out',
      shortcut: { key: '-', mod: true },
      run: () => {
        zoomBy(-ZOOM_STEP);
      },
    },
    {
      id: 'view.zoomReset',
      title: 'Actual size',
      shortcut: { key: '0', mod: true },
      run: () => {
        ui.getState().setZoom(ZOOM.default);
      },
    },
    {
      id: 'view.toggleTheme',
      title: 'Toggle light and dark theme',
      shortcut: { key: 'l', mod: true, shift: true },
      run: () => {
        settings.set(THEME_SETTING, ui.getState().theme === 'dark' ? 'light' : 'dark');
      },
    },
    {
      id: 'view.toggleSidebar',
      title: 'Toggle tracks',
      run: () => {
        ui.getState().togglePanel('sidebar');
      },
    },
    {
      id: 'view.togglePanel',
      title: 'Toggle mixer',
      // Guitar Pro's "Show/Hide global view", which holds its mixer.
      shortcut: { key: 'F8' },
      run: () => {
        ui.getState().toggleMixer();
      },
    },
    {
      id: 'view.toggleRightPanel',
      title: 'Toggle right panel',
      run: () => {
        ui.getState().togglePanel('rightPanel');
      },
    },
    {
      id: 'view.toggleViewMode',
      title: 'Toggle page and continuous view',
      shortcut: { key: 'F4' },
      run: () => {
        const { view, setViewMode } = ui.getState();
        setViewMode(view.mode === 'paged' ? 'continuous' : 'paged');
      },
    },
    {
      id: 'view.followPlayback',
      title: 'Follow playback',
      run: () => {
        ui.getState().requestFollow();
      },
    },
  ];
}
