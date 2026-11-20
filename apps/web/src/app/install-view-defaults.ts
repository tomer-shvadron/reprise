import { DEFAULT_VIEW_MODE_SETTING, DEFAULT_ZOOM_SETTING } from '@/state/app-settings';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

/**
 * Applies the score's default view mode and zoom to the ui: once the stored values load, and on
 * each change in Settings. F4, zoom and the rest change the view only, never the setting, so a
 * default is what the app starts with, not what it last had. Returns its cleanup.
 */
export function installViewDefaults(deps: { settings: SettingsStore; ui: UiStore }): () => void {
  const { settings, ui } = deps;
  const applyMode = () => {
    ui.getState().setViewMode(settings.get(DEFAULT_VIEW_MODE_SETTING));
  };
  const applyZoom = () => {
    ui.getState().setZoom(settings.get(DEFAULT_ZOOM_SETTING));
  };
  applyMode();
  applyZoom();
  // A subscription fires on the hydration that changes a value, so a stored choice reaches the ui.
  const stops = [
    settings.subscribe(DEFAULT_VIEW_MODE_SETTING, applyMode),
    settings.subscribe(DEFAULT_ZOOM_SETTING, applyZoom),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
