import { BOTTOM_DOCK_HEIGHT_SETTING, BOTTOM_DOCK_OPEN_SETTING } from '@/state/app-settings';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

/**
 * Keeps the bottom dock's open state and height in step with their settings: the stored values
 * show once they load, and a change in the ui is written back (the open state at once, the height
 * when a resize ends, which is when the ui commits it). Returns its cleanup.
 */
export function installBottomDock(deps: { settings: SettingsStore; ui: UiStore }): () => void {
  const { settings, ui } = deps;

  const applyOpen = () => {
    ui.getState().setBottomPanelOpen(settings.get(BOTTOM_DOCK_OPEN_SETTING));
  };
  const applyHeight = () => {
    const state = ui.getState();
    state.setBottomPanelHeight(settings.get(BOTTOM_DOCK_HEIGHT_SETTING));
    // A restored height is already stored; committing it keeps the ui's two heights in step.
    state.persistBottomPanelHeight();
  };
  // Only a stored value is applied: before the load the defaults must not overwrite what the
  // user already did, and a set-before-load wins over the stored rows in the store.
  if (settings.isStored(BOTTOM_DOCK_OPEN_SETTING)) applyOpen();
  if (settings.isStored(BOTTOM_DOCK_HEIGHT_SETTING)) applyHeight();
  const unsubscribe = [
    settings.subscribe(BOTTOM_DOCK_OPEN_SETTING, applyOpen),
    settings.subscribe(BOTTOM_DOCK_HEIGHT_SETTING, applyHeight),
  ];

  const stopWatching = ui.subscribe((state, previous) => {
    if (
      state.bottomPanel.open !== previous.bottomPanel.open &&
      state.bottomPanel.open !== settings.get(BOTTOM_DOCK_OPEN_SETTING)
    ) {
      settings.set(BOTTOM_DOCK_OPEN_SETTING, state.bottomPanel.open);
    }
    if (
      state.bottomPanelHeightCommitted !== previous.bottomPanelHeightCommitted &&
      state.bottomPanelHeightCommitted !== settings.get(BOTTOM_DOCK_HEIGHT_SETTING)
    ) {
      settings.set(BOTTOM_DOCK_HEIGHT_SETTING, state.bottomPanelHeightCommitted);
    }
  });

  return () => {
    stopWatching();
    for (const stop of unsubscribe) stop();
  };
}
