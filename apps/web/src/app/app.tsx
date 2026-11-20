import type { Track } from '@reprise/model';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AddTrackButton,
  EditorDialogs,
  EffectsPanel,
  HistoryPanel,
  historyLabel,
  TrackRowMenu,
} from '@/features/editor';
import {
  DraftRecoveryDialog,
  ExportDialog,
  installLibrary,
  installSettings,
  libraryOf,
  LibraryScreen,
  RecentSongs,
  UnimportedBanner,
} from '@/features/library';
import { checkSections, SettingsDialog } from '@/features/settings';
import { SoundManager } from '@/features/sounds';
import {
  installPracticeLog,
  SpeedTrainerChip,
  TrainerPanel,
  TunerButton,
} from '@/features/trainer';
import { PrintDialog, PrintRoot } from '@/features/score';
import { MixerPanel, TrackSidebar } from '@/features/tracks';
import { TransportBar } from '@/features/transport';
import type { RepriseBridge } from '@/platform/bridge';
import { installHistoryMenu } from '@/state/history-menu';
import type { PanelView } from '@/state/ui';

import { AppFrame } from './app-frame';
import { AppHeader } from './header/app-header';
import { installCloseGuard } from './close-guard';
import { installBottomDock } from './bottom-dock/install-bottom-dock';
import { installTheme } from './install-theme';
import { installViewDefaults } from './install-view-defaults';
import { installRightPanel, storeRightPanelWidth } from './right-panel/install-right-panel';
import { CommandPalette } from './command-palette';
import { ShortcutSheet } from './shortcut-sheet';
import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';
import { DropZone } from './drop-zone';
import { installFirstGesture } from './first-gesture';
import { formatShortcut, type KeyboardPlatform } from './keyboard';
import { PanelRail, PanelTabs } from './right-panel';
import { Notices } from './notices';
import { SavePromptDialog } from './save-prompt';
import { ScorePane } from './score-pane';
import { StatusBar } from './status-bar/status-bar';
import { ScreenHost } from './screen-host';
import type { AppServices } from './services';
import { AppServicesProvider } from './services-context';
import { installShortcutDispatcher, menuCommandAllowed } from './shortcut-dispatcher';
import { SETTINGS_SECTIONS } from './settings-sections';
import { UnsavedChangesHost } from './unsaved-dialog';
import { installWindowTitle } from './window-title';
import { CommandSourceContext } from './use-command';

checkSections(SETTINGS_SECTIONS);

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

/** The right panel: the mixer, the effects, the history and the trainer tools. */
function RightPanel({ view }: { view: PanelView }) {
  if (view === 'mixer') return <MixerPanel />;
  if (view === 'effects') return <EffectsPanel />;
  if (view === 'history') return <HistoryPanel />;
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

  // The persisted preferences, loaded from the library's database; attach is idempotent.
  useEffect(() => {
    installSettings(services, libraryOf(services).db);
  }, [services]);

  useEffect(() => installTheme(services), [services]);
  useEffect(() => installBottomDock(services), [services]);
  useEffect(() => installRightPanel(services), [services]);

  useEffect(() => installViewDefaults(services), [services]);

  useEffect(() => installLibrary(services), [services]);

  // The installed sound packs, before any song names one; a failed scan leaves the list empty.
  useEffect(() => {
    services.sounds.scan().catch(() => undefined);
  }, [services]);

  // `● name — Reprise` while modified; on desktop the window follows the page title.
  useEffect(() => installWindowTitle(services.document, services.platform), [services]);

  useEffect(
    () =>
      installCloseGuard({
        services,
        discardDraft: () => libraryOf(services).drafts.discardOpen(),
      }),
    [services],
  );

  useEffect(
    () => installHistoryMenu(services.document, services.platform, historyLabel),
    [services],
  );

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

  const keyOf = (id: string) => {
    const command = registry.get(id);
    return command && registry.shortcutOf(command);
  };
  const openShortcut = keyOf('file.open');
  const paletteShortcut = keyOf('app.commandPalette');
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
            header={
              <CommandSourceContext value={source}>
                <AppHeader />
              </CommandSourceContext>
            }
            score={<ScorePane hint={hint} />}
            banner={<UnimportedBanner />}
            transport={
              <TransportBar
                registry={registry}
                keyboard={keyboard}
                speedTrainer={<SpeedTrainerChip />}
                tuner={<TunerButton />}
              />
            }
            status={
              <CommandSourceContext value={source}>
                <StatusBar />
              </CommandSourceContext>
            }
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
                <PanelTabs>
                  <RightPanel view={rightPanelView} />
                </PanelTabs>
              </CommandSourceContext>
            }
            onRightPanelResizeEnd={() => {
              storeRightPanelWidth(services);
            }}
            rail={
              <CommandSourceContext value={source}>
                <PanelRail />
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
        <SettingsDialog sections={SETTINGS_SECTIONS} />
        <CommandPalette registry={registry} ui={ui} keyboard={keyboard} services={services} />
        <ShortcutSheet registry={registry} ui={ui} keyboard={keyboard} />
        <DropZone />
        <Notices />
        <SavePromptDialog />
        <EditorDialogs />
        <UnsavedChangesHost />
        <ExportDialog />
        <DraftRecoveryDialog />
        <PrintDialog store={services.print} />
        <PrintRoot store={services.print} />
      </TooltipProvider>
    </AppServicesProvider>
  );
}
