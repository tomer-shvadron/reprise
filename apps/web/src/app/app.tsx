import type { Track } from '@reprise/model';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { Placeholder } from '@/components/placeholder';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AddTrackButton, EditorDialogs, TrackRowMenu } from '@/features/editor';
import {
  installLibrary,
  libraryOf,
  LibraryScreen,
  RecentSongs,
  UnimportedBanner,
} from '@/features/library';
import { SoundManager } from '@/features/sounds';
import { installPracticeLog, TrainerPanel } from '@/features/trainer';
import { PrintDialog, PrintRoot } from '@/features/score';
import { MixerPanel, TrackSidebar } from '@/features/tracks';
import { TransportBar } from '@/features/transport';
import type { RepriseBridge } from '@/platform/bridge';
import type { PanelView } from '@/state/ui';

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
import { ScreenHost } from './screen-host';
import type { AppServices } from './services';
import { AppServicesProvider } from './services-context';
import { installShortcutDispatcher, menuCommandAllowed } from './shortcut-dispatcher';
import { CommandSourceContext } from './use-command';

// Module-level so the sidebar's memoised rows see the same function every render.
const addTrackButton = <AddTrackButton />;
const renderTrackRowMenu = (track: Track, index: number) => (
  <TrackRowMenu track={track} index={index} />
);

interface AppProps {
  services: AppServices;
  keyboard: KeyboardPlatform;
  /** The native menu's command feed; absent outside Electron. */
  onMenuCommand?: RepriseBridge['onMenuCommand'] | undefined;
}

/** The right panel: the mixer, the trainer tools, and placeholders the WP-082 and WP-084 PRs replace. */
function RightPanel({ view }: { view: PanelView }) {
  if (view === 'mixer') return <MixerPanel />;
  if (view === 'effects') return <Placeholder title="Effects" workPackage="WP-082" />;
  if (view === 'history') return <Placeholder title="History" workPackage="WP-084" />;
  return <TrainerPanel view={view} />;
}

export function App({ services, keyboard, onMenuCommand }: AppProps) {
  const { ui, audio } = services;
  const [registry] = useState(() => createAppRegistry(services));
  const source = useMemo(() => ({ registry, keyboard }), [registry, keyboard]);
  const theme = useStore(ui, (state) => state.theme);
  const screen = useStore(ui, (state) => state.screen);
  const rightPanelView = useStore(ui, (state) => state.rightPanelView);
  const bottomView = useStore(ui, (state) => state.bottomPanel.view);

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

  useEffect(() => installLibrary(services), [services]);

  useEffect(
    () => installPracticeLog(services, libraryOf(services).db.practiceSessions),
    [services],
  );

  useEffect(
    () =>
      onMenuCommand?.((id) => {
        const command = registry.get(id);
        if (command && menuCommandAllowed(id)) runCommand(command);
      }),
    [registry, onMenuCommand],
  );

  const openShortcut = registry.get('file.open')?.shortcut;
  const paletteShortcut = registry.get('app.commandPalette')?.shortcut;
  const hint = (
    <>
      <p className="text-ink-muted">
        Open a file{openShortcut && ` (${formatShortcut(openShortcut, keyboard)})`} or drop one
        here, or press {paletteShortcut && formatShortcut(paletteShortcut, keyboard)} for every
        command.
      </p>
      <RecentSongs />
    </>
  );

  return (
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <div className="h-full" inert={screen !== 'player'}>
          <AppFrame
            ui={ui}
            score={<ScorePane hint={hint} />}
            banner={<UnimportedBanner />}
            transport={<TransportBar registry={registry} keyboard={keyboard} />}
            sidebar={
              <TrackSidebar
                registry={registry}
                keyboard={keyboard}
                headerActions={addTrackButton}
                rowMenu={renderTrackRowMenu}
              />
            }
            bottom={
              <CommandSourceContext value={source}>
                <TrainerPanel view={bottomView} />
              </CommandSourceContext>
            }
            panel={
              <CommandSourceContext value={source}>
                <RightPanel view={rightPanelView} />
              </CommandSourceContext>
            }
          />
        </div>
        {screen !== 'player' && (
          <ScreenHost
            label={screen === 'library' ? 'Library' : 'Sounds'}
            onClose={() => {
              ui.getState().setScreen('player');
            }}
          >
            {screen === 'library' ? <LibraryScreen /> : <SoundManager />}
          </ScreenHost>
        )}
        <CommandPalette registry={registry} ui={ui} keyboard={keyboard} />
        <DropZone />
        <Notices />
        <SavePromptDialog />
        <EditorDialogs />
        <PrintDialog store={services.print} />
        <PrintRoot store={services.print} />
      </TooltipProvider>
    </AppServicesProvider>
  );
}
