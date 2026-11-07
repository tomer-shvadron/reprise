import { useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from 'zustand';

import { TooltipProvider } from '@/components/ui/tooltip';
import { MixerPanel, TrackSidebar } from '@/features/tracks';
import { TransportBar } from '@/features/transport';
import type { RepriseBridge } from '@/platform/bridge';

import { AppFrame } from './app-frame';
import { CommandPalette } from './command-palette';
import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';
import { DropZone } from './drop-zone';
import { installFirstGesture } from './first-gesture';
import { formatShortcut, type KeyboardPlatform } from './keyboard';
import { Notices } from './notices';
import { SavePromptDialog } from './save-prompt';
import { ScorePane } from './score-pane';
import type { AppServices } from './services';
import { AppServicesProvider } from './services-context';
import { installShortcutDispatcher } from './shortcut-dispatcher';

interface AppProps {
  services: AppServices;
  keyboard: KeyboardPlatform;
  /** The native menu's command feed; absent outside Electron. */
  onMenuCommand?: RepriseBridge['onMenuCommand'] | undefined;
}

export function App({ services, keyboard, onMenuCommand }: AppProps) {
  const { ui, audio } = services;
  const [registry] = useState(() => createAppRegistry(services));
  const theme = useStore(ui, (state) => state.theme);

  useLayoutEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => installShortcutDispatcher(window, registry, keyboard), [registry, keyboard]);

  useEffect(
    () =>
      installFirstGesture(window, () => {
        audio.unlock();
      }),
    [audio],
  );

  useEffect(
    () =>
      onMenuCommand?.((id) => {
        const command = registry.get(id);
        if (command) runCommand(command);
      }),
    [registry, onMenuCommand],
  );

  const openShortcut = registry.get('file.open')?.shortcut;
  const paletteShortcut = registry.get('app.commandPalette')?.shortcut;
  const hint = (
    <p className="text-ink-muted">
      Open a file{openShortcut && ` (${formatShortcut(openShortcut, keyboard)})`} or drop one here,
      or press {paletteShortcut && formatShortcut(paletteShortcut, keyboard)} for every command.
    </p>
  );

  return (
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <AppFrame
          ui={ui}
          score={<ScorePane hint={hint} />}
          transport={<TransportBar registry={registry} keyboard={keyboard} />}
          sidebar={<TrackSidebar registry={registry} keyboard={keyboard} />}
          panel={<MixerPanel />}
        />
        <CommandPalette registry={registry} ui={ui} keyboard={keyboard} />
        <DropZone />
        <Notices />
        <SavePromptDialog />
      </TooltipProvider>
    </AppServicesProvider>
  );
}
