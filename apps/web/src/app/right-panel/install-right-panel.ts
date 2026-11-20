import { RIGHT_PANEL_OPEN_SETTING, RIGHT_PANEL_WIDTH_SETTING } from '@/state/app-settings';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

/**
 * Writes the panel's width into its setting; the resize handle calls it when a drag or a key
 * press ends. Before the settings load a value is set even when it equals the default, so it goes
 * in as the user's change and wins over the stored row.
 */
export function storeRightPanelWidth(deps: { settings: SettingsStore; ui: UiStore }): void {
  const { settings, ui } = deps;
  const width = ui.getState().panelWidths.rightPanel;
  if (!settings.hydrated() || width !== settings.get(RIGHT_PANEL_WIDTH_SETTING)) {
    settings.set(RIGHT_PANEL_WIDTH_SETTING, width);
  }
}

/**
 * Keeps the right panel's open state and width in step with their settings: the stored values
 * show once they load (the open state as a restored one, which takes no focus), and an open or
 * collapse in the ui is written back at once. A change made before the load wins over the stored
 * row. Returns its cleanup.
 */
export function installRightPanel(deps: { settings: SettingsStore; ui: UiStore }): () => void {
  const { settings, ui } = deps;

  const applyOpen = () => {
    const open = settings.get(RIGHT_PANEL_OPEN_SETTING);
    if (ui.getState().panels.rightPanel !== open) ui.getState().restoreRightPanelOpen(open);
  };
  const applyWidth = () => {
    ui.getState().setPanelWidth('rightPanel', settings.get(RIGHT_PANEL_WIDTH_SETTING));
  };
  // Only a stored value is applied: before the load the defaults must not overwrite what the
  // user already did, and a set-before-load wins over the stored rows in the store.
  if (settings.isStored(RIGHT_PANEL_OPEN_SETTING)) applyOpen();
  if (settings.isStored(RIGHT_PANEL_WIDTH_SETTING)) applyWidth();
  const unsubscribe = [
    settings.subscribe(RIGHT_PANEL_OPEN_SETTING, applyOpen),
    settings.subscribe(RIGHT_PANEL_WIDTH_SETTING, applyWidth),
  ];

  const stopWatching = ui.subscribe((state, previous) => {
    const open = state.panels.rightPanel;
    if (open === previous.panels.rightPanel) return;
    // A restore echoes the stored value, so only the user's own change is written.
    if (state.panelRestored) return;
    if (!settings.hydrated() || open !== settings.get(RIGHT_PANEL_OPEN_SETTING)) {
      settings.set(RIGHT_PANEL_OPEN_SETTING, open);
    }
  });

  return () => {
    stopWatching();
    for (const stop of unsubscribe) stop();
  };
}
