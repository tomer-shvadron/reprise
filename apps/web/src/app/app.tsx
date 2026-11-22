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
  AsciiExportDialog,
  ExportDialog,
  installLibrary,
  installSettings,
  libraryOf,
  LibraryScreen,
  RecentSongs,
  UnimportedBanner,
} from '@/features/library';
import { checkSections, SettingsDialog } from '@/features/settings';
import { DefaultSoundOffer, SoundManager } from '@/features/sounds';
import {
  installPracticeLog,
  SpeedTrainerChip,
  TrainerPanel,
  TunerButton,
} from '@/features/trainer';
import { ImageExportDialog, PrintDialog, PrintRoot } from '@/features/score';
import { MixerPanel, TrackSidebar } from '@/features/tracks';
import { Announcer, TransportBar } from '@/features/transport';
import type { RepriseBridge } from '@/platform/bridge';
import { installHistoryMenu } from '@/state/history-menu';
import type { PanelView } from '@/state/ui';

import { AppFrame } from './app-frame';
import { AppSheet } from './app-sheet';
import { AppHeader } from './header/app-header';
import { installCloseGuard } from './close-guard';
import { installBottomDock } from './bottom-dock/install-bottom-dock';
import { installTheme } from './install-theme';
import { installViewDefaults } from './install-view-defaults';
import { installPracticeMode, PracticeCapsule, SectionStrip } from './practice-mode';
import { installRightPanel, storeRightPanelWidth } from './right-panel/install-right-panel';
import { CommandPalette } from './command-palette';
import { ShortcutSheet } from './shortcut-sheet';
import { createAppMenus } from './app-menus';
import { createAppRegistry } from './app-registry';
import { ContextMenuHost } from './context-menu/context-menu-host';
import { MenuRegistryContext } from './context-menu/menu-context';
import { runCommand } from './command-registry';
import { DropZone } from './drop-zone';
import { installFirstGesture } from './first-gesture';
import { installMenuChecks } from './install-menu-checks';
import { installMenuKeys } from './install-menu-keys';
import { SHORTCUT_OVERRIDES_SETTING } from './keymap';
import { formatShortcut, shortcutOn, type KeyboardPlatform } from './keyboard';
import { PanelRail, PanelTabs } from './right-panel';
import { Notices } from './notices';
import { SavePromptDialog } from './save-prompt';
import { ScorePane } from './score-pane';
import { StatusBar } from './status-bar/status-bar';
import type { AppServices } from './services';
import { AppServicesProvider } from './services-context';
import {
  installShortcutDispatcher,
  menuCommandAllowed,
  menuKeyYieldsToField,
} from './shortcut-dispatcher';
import { SETTINGS_SECTIONS } from './settings-sections';
import { UnsavedChangesHost } from './unsaved-dialog';
import { installWindowTitle } from './window-title';
import { CommandSourceProvider } from './command-source-provider';

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
  const [registry] = useState(() => createAppRegistry(services, keyboard));
  const [menus] = useState(() => createAppMenus(registry));
  const menuRegistry = useMemo(() => ({ menus, registry, keyboard }), [menus, registry, keyboard]);
  const theme = useStore(ui, (state) => state.theme);
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
  useEffect(() => installPracticeMode(services), [services]);

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
    () =>
      installMenuKeys({
        registry,
        settings: services.settings,
        platform: services.platform,
        keyboard,
        subscribe: (listener) => services.settings.subscribe(SHORTCUT_OVERRIDES_SETTING, listener),
      }),
    [registry, services, keyboard],
  );

  useEffect(
    () => installMenuChecks({ playback: services.playback, platform: services.platform }),
    [services],
  );

  useEffect(
    () => installPracticeLog(services, libraryOf(services).db.practiceSessions),
    [services],
  );

  useEffect(
    () =>
      onMenuCommand?.((id, viaAccelerator) => {
        const command = registry.get(id);
        if (!command || !menuCommandAllowed(id)) return;
        // The renderer leaves a key without Cmd or Ctrl to a focused field; the menu's own
        // accelerator (Option+C is a character on a Mac) must do the same, while a click on the
        // item runs it from anywhere.
        if (
          viaAccelerator &&
          menuKeyYieldsToField(shortcutOn(registry.shortcutOf(command), keyboard))
        ) {
          return;
        }
        runCommand(command);
      }),
    [registry, keyboard, onMenuCommand],
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
      <MenuRegistryContext value={menuRegistry}>
        <TooltipProvider>
          <CommandSourceProvider
            registry={registry}
            keyboard={keyboard}
            settings={services.settings}
            editing={services.editing}
          >
            <div className="h-full">
              <AppFrame
                ui={ui}
                header={<AppHeader />}
                score={<ScorePane hint={hint} />}
                banner={<UnimportedBanner />}
                scoreOverlay={<DefaultSoundOffer />}
                transport={
                  <TransportBar
                    registry={registry}
                    keyboard={keyboard}
                    speedTrainer={<SpeedTrainerChip />}
                    tuner={<TunerButton />}
                  />
                }
                status={<StatusBar />}
                sidebar={
                  <TrackSidebar
                    registry={registry}
                    keyboard={keyboard}
                    headerActions={addTrackButton}
                    rowMenu={renderTrackRowMenu}
                  />
                }
                bottom={<TrainerPanel view={bottomView} />}
                panel={
                  <PanelTabs>
                    <RightPanel view={rightPanelView} />
                  </PanelTabs>
                }
                sectionStrip={<SectionStrip />}
                capsule={<PracticeCapsule />}
                onRightPanelResizeEnd={() => {
                  storeRightPanelWidth(services);
                }}
                rail={<PanelRail />}
              />
            </div>
            <SettingsDialog sections={SETTINGS_SECTIONS} />
          </CommandSourceProvider>
          <AppSheet id="library" title="Library" width="wide">
            <LibraryScreen />
          </AppSheet>
          <AppSheet id="sounds" title="Sounds" width="medium">
            <SoundManager />
          </AppSheet>
          <CommandPalette registry={registry} ui={ui} keyboard={keyboard} services={services} />
          <ContextMenuHost registry={registry} menus={menus} keyboard={keyboard} />
          <ShortcutSheet
            registry={registry}
            ui={ui}
            settings={services.settings}
            keyboard={keyboard}
          />
          <DropZone />
          <Notices />
          {/* Outside the frame: the footer is gone in practice mode, and a live region has to stay mounted. */}
          <Announcer />
          <SavePromptDialog />
          <EditorDialogs />
          <UnsavedChangesHost />
          <ExportDialog />
          <AsciiExportDialog />
          <ImageExportDialog exporter={libraryOf(services).imageExport} />
          <DraftRecoveryDialog />
          <PrintDialog store={services.print} />
          <PrintRoot store={services.print} />
        </TooltipProvider>
      </MenuRegistryContext>
    </AppServicesProvider>
  );
}
