import type { MenuCommandId } from '@/platform/bridge';
import type { OpenedFile, Platform } from '@/platform/platform';
import { ZOOM, type UiStore } from '@/state/ui';

import type { Command } from './command-registry';

export const GUITAR_PRO_FILES = [
  { name: 'Guitar Pro', extensions: ['gp', 'gpx', 'gp5', 'gp4', 'gp3'] },
] as const;

const ZOOM_STEP = 0.1;

export interface AppCommandDeps {
  ui: UiStore;
  platform: Platform;
  onFileOpened: (file: OpenedFile) => void;
}

type AppCommand = Command & { id: MenuCommandId | 'app.commandPalette' };

export function appCommands({ ui, platform, onFileOpened }: AppCommandDeps): AppCommand[] {
  // Until the document store lands, saving writes back the bytes of the last opened file.
  let current: { file: OpenedFile; path?: string } | undefined;

  const saveAs = async () => {
    if (!current) return;
    const path = await platform.saveFile(current.file.name, current.file.bytes, GUITAR_PRO_FILES);
    if (path !== undefined) current.path = path;
  };
  const zoomBy = (delta: number) => {
    ui.getState().setZoom(Math.round((ui.getState().zoom + delta) * 10) / 10);
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
      id: 'file.open',
      title: 'Open file…',
      shortcut: { key: 'o', mod: true },
      run: async () => {
        const file = await platform.openFile(GUITAR_PRO_FILES);
        if (!file) return;
        current = { file };
        onFileOpened(file);
      },
    },
    {
      id: 'file.save',
      title: 'Save',
      shortcut: { key: 's', mod: true },
      run: async () => {
        if (current?.path === undefined) return saveAs();
        await platform.writeFile(current.path, current.file.bytes);
      },
    },
    {
      id: 'file.saveAs',
      title: 'Save as…',
      shortcut: { key: 's', mod: true, shift: true },
      run: saveAs,
    },
    {
      id: 'file.print',
      title: 'Print…',
      shortcut: { key: 'p', mod: true },
      run: () => platform.print(),
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
        ui.getState().toggleTheme();
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
      title: 'Toggle panel',
      run: () => {
        ui.getState().togglePanel('rightPanel');
      },
    },
  ];
}
