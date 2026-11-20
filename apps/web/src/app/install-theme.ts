import { THEME_SETTING } from '@/state/app-settings';
import { resolveTheme, type Theme } from '@/state/theme';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

const QUERY = '(prefers-color-scheme: light)';

/**
 * Keeps `ui.theme`, the theme on screen, in step with the `appearance.theme` setting, and under
 * `system` with the operating system's live preference. Returns its cleanup.
 */
export function installTheme(deps: { settings: SettingsStore; ui: UiStore }): () => void {
  const { settings, ui } = deps;
  let media: MediaQueryList | undefined;
  try {
    media = window.matchMedia(QUERY);
  } catch {
    media = undefined;
  }

  const resolve = (): Theme => resolveTheme(settings.get(THEME_SETTING), media?.matches === true);
  const apply = () => {
    ui.getState().setTheme(resolve());
  };
  apply();

  const unsubscribe = settings.subscribe(THEME_SETTING, apply);
  // Only the system theme follows the operating system; a stored choice ignores it.
  const onChange = () => {
    if (settings.get(THEME_SETTING) === 'system') apply();
  };
  media?.addEventListener('change', onChange);
  return () => {
    unsubscribe();
    media?.removeEventListener('change', onChange);
  };
}
