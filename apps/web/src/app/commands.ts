import type { OpenedFile, Platform } from '@/platform/platform';
import type { UiStore } from '@/state/ui';

import type { Command } from './command-registry';

export const GUITAR_PRO_FILES = [
  { name: 'Guitar Pro', extensions: ['gp', 'gpx', 'gp5', 'gp4', 'gp3'] },
] as const;

export interface AppCommandDeps {
  ui: UiStore;
  platform: Platform;
  onFileOpened: (file: OpenedFile) => void;
}

export function appCommands({ ui, platform, onFileOpened }: AppCommandDeps): Command[] {
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
        if (file) onFileOpened(file);
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
  ];
}
