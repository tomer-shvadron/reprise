import { RIGHT_PANEL_OPEN_SETTING, RIGHT_PANEL_WIDTH_SETTING } from '@/state/app-settings';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

/** A drag changes the width on every pointer move; one write follows once it settles. */
const WIDTH_WRITE_DELAY_MS = 300;

/**
 * Keeps the right panel's open state and width in step with their settings: the stored values
 * show once they load, and a change in the ui is written back (the width after a short pause, so
 * a resize is one write). Returns its cleanup, which flushes a pending width write.
 */
export function installRightPanel(deps: { settings: SettingsStore; ui: UiStore }): () => void {
  const { settings, ui } = deps;

  const applyOpen = () => {
    ui.getState().setPanelOpen('rightPanel', settings.get(RIGHT_PANEL_OPEN_SETTING));
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  const writeWidth = () => {
    timer = undefined;
    const width = ui.getState().panelWidths.rightPanel;
    if (width !== settings.get(RIGHT_PANEL_WIDTH_SETTING))
      settings.set(RIGHT_PANEL_WIDTH_SETTING, width);
  };
  const stopWatching = ui.subscribe((state, previous) => {
    if (state.panels.rightPanel !== previous.panels.rightPanel) {
      if (state.panels.rightPanel !== settings.get(RIGHT_PANEL_OPEN_SETTING)) {
        settings.set(RIGHT_PANEL_OPEN_SETTING, state.panels.rightPanel);
      }
    }
    if (state.panelWidths.rightPanel !== previous.panelWidths.rightPanel) {
      clearTimeout(timer);
      timer = setTimeout(writeWidth, WIDTH_WRITE_DELAY_MS);
    }
  });

  return () => {
    stopWatching();
    for (const stop of unsubscribe) stop();
    if (timer !== undefined) {
      clearTimeout(timer);
      writeWidth();
    }
  };
}
