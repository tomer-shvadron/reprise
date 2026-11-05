import { useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from 'zustand';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { OpenedFile, Platform } from '@/platform/platform';
import type { UiStore } from '@/state/ui';

import { AppFrame } from './app-frame';
import { CommandPalette } from './command-palette';
import { CommandRegistry } from './command-registry';
import { appCommands } from './commands';
import { formatShortcut, type KeyboardPlatform } from './keyboard';
import { installShortcutDispatcher } from './shortcut-dispatcher';

interface AppProps {
  ui: UiStore;
  platform: Platform;
  keyboard: KeyboardPlatform;
}

export function App({ ui, platform, keyboard }: AppProps) {
  const [opened, setOpened] = useState<OpenedFile | undefined>(undefined);
  const [registry] = useState(() => {
    const commands = new CommandRegistry();
    for (const command of appCommands({ ui, platform, onFileOpened: setOpened })) {
      commands.register(command);
    }
    return commands;
  });
  const theme = useStore(ui, (state) => state.theme);

  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => installShortcutDispatcher(window, registry, keyboard), [registry, keyboard]);

  const openShortcut = registry.get('file.open')?.shortcut;
  const paletteShortcut = registry.get('app.commandPalette')?.shortcut;

  return (
    <TooltipProvider>
      <AppFrame
        ui={ui}
        score={
          opened ? (
            <p>
              {opened.name}{' '}
              <span className="text-ink-muted">({opened.bytes.byteLength} bytes)</span>
            </p>
          ) : (
            <p className="text-ink-muted">
              Open a file{openShortcut && ` (${formatShortcut(openShortcut, keyboard)})`}, or press{' '}
              {paletteShortcut && formatShortcut(paletteShortcut, keyboard)} for every command.
            </p>
          )
        }
      />
      <CommandPalette registry={registry} ui={ui} keyboard={keyboard} />
    </TooltipProvider>
  );
}
